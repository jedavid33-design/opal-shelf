// Opal Shelf Worker v0.0.5 is intentionally self-contained for Cloudflare's
// single-file dashboard editor. Do not replace these helpers with relative imports.
const id = (prefix = "id") => `${prefix}_${crypto.randomUUID()}`;

function localDateKey(value = new Date(), timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function addCalendarDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month-1, day+amount)).toISOString().slice(0,10);
}

function durationSeconds(start, end = new Date()) {
  return Math.max(0, Math.round((new Date(end).getTime()-new Date(start).getTime())/1000));
}

function goalForDate(history, dateKey) {
  return [...history].filter((goal)=>goal.effective_date<=dateKey).sort((a,b)=>b.effective_date.localeCompare(a.effective_date))[0] || null;
}

function dayQualifies(goal, activity = {}) {
  if (!goal || goal.paused) return null;
  if (goal.goal_type === "minutes") return Number(activity.seconds||0) >= Number(goal.amount)*60;
  if (goal.goal_type === "pages") return Number(activity.pages||0) >= Number(goal.amount);
  return false;
}

function computeStreak(history, activityByDate, todayKey) {
  const firstDate=[...history].sort((a,b)=>a.effective_date.localeCompare(b.effective_date))[0]?.effective_date;
  if (!firstDate) return { current:0, longest:0 };
  const qualifying=new Map();
  let date=firstDate;
  while(date<=todayKey){qualifying.set(date,dayQualifies(goalForDate(history,date),activityByDate[date]));date=addCalendarDays(date,1);}
  let longest=0,run=0;
  [...qualifying.keys()].sort().forEach((key)=>{const result=qualifying.get(key);if(result===true){run+=1;longest=Math.max(longest,run);}else if(result===false)run=0;});
  let cursor=todayKey,current=0;
  if(qualifying.get(cursor)===false)cursor=addCalendarDays(cursor,-1);
  while(cursor>=firstDate){const result=qualifying.get(cursor);if(result===true)current+=1;else if(result===false)break;cursor=addCalendarDays(cursor,-1);}
  return { current,longest };
}

function annualStats(reads, year, countRereads = true) {
  const completed=reads.filter((read)=>read.state==="finished"&&String(read.finish_date||"").startsWith(String(year)));
  const uniqueBooks=new Set(completed.map((read)=>read.book_id)).size;
  const firstByBook=new Map();
  [...reads].filter((read)=>read.state==="finished").sort((a,b)=>String(a.finish_date).localeCompare(String(b.finish_date))).forEach((read)=>{if(!firstByBook.has(read.book_id))firstByBook.set(read.book_id,read.id);});
  const rereads=completed.filter((read)=>firstByBook.get(read.book_id)!==read.id).length;
  return { completedReads:completed.length, uniqueBooks, rereads, counted:countRereads?completed.length:completed.length-rereads };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function cors(response, request, env) {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGIN || "*";
  const headers = new Headers(response.headers);
  if (allowed === "*" || !origin || origin === allowed) headers.set("access-control-allow-origin", allowed === "*" ? "*" : origin);
  headers.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const now = () => new Date().toISOString();
const parseJson = async (request) => {
  try { return await request.json(); } catch { throw new HttpError(400, "Invalid JSON body"); }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function auth(request, env) {
  if (!env.OPAL_SHELF_ACCESS_TOKEN) return;
  const header = request.headers.get("authorization") || "";
  if (header !== `Bearer ${env.OPAL_SHELF_ACCESS_TOKEN}`) throw new HttpError(401, "Access token required");
}

function decodeBook(row) {
  if (!row) return row;
  const parse = (value) => { try { return JSON.parse(value || "[]"); } catch { return []; } };
  return {
    ...row,
    authors: parse(row.authors_json),
    genres: parse(row.genres_json),
    narrators: parse(row.narrators_json),
    personal_tags: parse(row.personal_tags_json),
    favorite: Boolean(row.favorite),
    book_dnf: Boolean(row.book_dnf)
  };
}

function cleanBook(input) {
  const title = String(input.title || "").trim();
  if (!title) throw new HttpError(400, "Title is required");
  const list = (value) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return {
    title,
    subtitle: String(input.subtitle || "").trim() || null,
    authors_json: JSON.stringify(list(input.authors)),
    cover_url: String(input.cover_url || "").trim() || null,
    series_name: String(input.series_name || "").trim() || null,
    series_number: input.series_number === "" || input.series_number == null ? null : Number(input.series_number),
    description: String(input.description || "").trim() || null,
    genres_json: JSON.stringify(list(input.genres)),
    format_metadata: String(input.format_metadata || "").trim() || null,
    isbn: String(input.isbn || "").trim() || null,
    publisher: String(input.publisher || "").trim() || null,
    publication_date: String(input.publication_date || "").trim() || null,
    page_count: input.page_count === "" || input.page_count == null ? null : Math.max(0, Number(input.page_count)),
    audiobook_runtime_seconds: input.audiobook_runtime_seconds === "" || input.audiobook_runtime_seconds == null ? null : Math.max(0, Number(input.audiobook_runtime_seconds)),
    narrators_json: JSON.stringify(list(input.narrators)),
    language: String(input.language || "").trim() || null,
    personal_tags_json: JSON.stringify(list(input.personal_tags)),
    favorite: input.favorite ? 1 : 0,
    status: ["want", "reading", "finished", "dnf"].includes(input.status) ? input.status : "want",
    book_dnf: input.status === "dnf" ? 1 : 0
  };
}

async function all(db, sql, ...binds) {
  return (await db.prepare(sql).bind(...binds).all()).results;
}

async function first(db, sql, ...binds) {
  return db.prepare(sql).bind(...binds).first();
}

async function syncBookStatus(db, bookId, timestamp = now()) {
  const book = await first(db, "SELECT status, book_dnf FROM books WHERE id=?", bookId);
  if (!book) return;
  const counts = await first(db, `SELECT
    SUM(CASE WHEN state='active' THEN 1 ELSE 0 END) AS active_count,
    SUM(CASE WHEN state='finished' THEN 1 ELSE 0 END) AS finished_count
    FROM read_throughs WHERE book_id=?`, bookId);
  const status = Number(counts?.active_count || 0) > 0
    ? "reading"
    : book.book_dnf
      ? "dnf"
      : Number(counts?.finished_count || 0) > 0
        ? "finished"
        : "want";
  await db.prepare("UPDATE books SET status=?,updated_at=? WHERE id=?").bind(status,timestamp,bookId).run();
}

async function bootstrap(db, url) {
  const today = url.searchParams.get("date") || localDateKey();
  const [bookRows, reads, sessions, goals, annualGoals, shelves, memberships, checkins] = await Promise.all([
    all(db, "SELECT * FROM books ORDER BY favorite DESC, title COLLATE NOCASE"),
    all(db, "SELECT * FROM read_throughs ORDER BY created_at DESC"),
    all(db, "SELECT * FROM reading_sessions ORDER BY started_at DESC"),
    all(db, "SELECT * FROM goal_history ORDER BY effective_date"),
    all(db, "SELECT * FROM annual_goals ORDER BY year DESC"),
    all(db, "SELECT * FROM custom_shelves ORDER BY name COLLATE NOCASE"),
    all(db, "SELECT * FROM shelf_books ORDER BY sort_order, added_at"),
    all(db, "SELECT * FROM daily_checkins ORDER BY session_date DESC")
  ]);
  const books = bookRows.map(decodeBook);
  const activity = {};
  for (const session of sessions.filter((item) => item.ended_at)) {
    activity[session.local_date] ||= { seconds: 0, pages: 0 };
    activity[session.local_date].seconds += Number(session.duration_seconds || 0);
  }
  for (const checkin of checkins) {
    activity[checkin.session_date] ||= { seconds: 0, pages: 0 };
    activity[checkin.session_date].pages += Number(checkin.pages_read || 0);
  }
  const year = Number(today.slice(0, 4));
  const annualGoal = annualGoals.find((goal) => Number(goal.year) === year) || { year, target_books: 30, count_rereads: 1 };
  const annual = annualStats(reads, year, Boolean(annualGoal.count_rereads));
  const dailyGoal = goalForDate(goals, today);
  return {
    today,
    books,
    reads,
    sessions,
    goals,
    annualGoals,
    shelves,
    memberships,
    checkins,
    dashboard: {
      todaySeconds: activity[today]?.seconds || 0,
      todayPages: activity[today]?.pages || 0,
      streak: computeStreak(goals, activity, today),
      dailyGoal,
      annualGoal,
      annual
    }
  };
}

async function pendingCheckins(db, date) {
  return all(db, `
    SELECT rs.read_id, rs.book_id, rs.local_date AS session_date,
      COUNT(*) AS session_count, SUM(rs.duration_seconds) AS duration_seconds,
      b.title, b.audiobook_runtime_seconds, rt.format, rt.progress_page, rt.progress_percent,
      rt.listening_speed, rt.audiobook_runtime_seconds_snapshot
    FROM reading_sessions rs
    JOIN books b ON b.id = rs.book_id
    JOIN read_throughs rt ON rt.id = rs.read_id
    LEFT JOIN daily_checkins dc ON dc.read_id = rs.read_id AND dc.session_date = rs.local_date
    WHERE rs.local_date < ? AND rs.ended_at IS NOT NULL AND dc.id IS NULL
    GROUP BY rs.read_id, rs.book_id, rs.local_date
    ORDER BY rs.local_date, MIN(rs.started_at)
  `, date);
}

async function handleApi(request, env, url) {
  auth(request, env);
  const db = env.DB;
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/bootstrap" && method === "GET") return json(await bootstrap(db, url));
  if (path === "/api/checkins/pending" && method === "GET") return json(await pendingCheckins(db, url.searchParams.get("date") || localDateKey()));

  if (path === "/api/books/search" && method === "GET") {
    const query = String(url.searchParams.get("q") || "").trim();
    if (query.length < 2) return json([]);
    const fields = "key,title,subtitle,author_name,cover_i,isbn,first_publish_year,publisher,language,number_of_pages_median,subject";
    const response = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=12&fields=${fields}`, { headers: { "user-agent": "OpalShelf/0.0.1" } });
    if (!response.ok) throw new HttpError(502, "Book search is temporarily unavailable");
    const data = await response.json();
    return json((data.docs || []).map((book) => ({
      source_id: book.key,
      title: book.title,
      subtitle: book.subtitle || "",
      authors: book.author_name || [],
      cover_url: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : "",
      isbn: book.isbn?.[0] || "",
      publisher: book.publisher?.[0] || "",
      publication_date: book.first_publish_year ? String(book.first_publish_year) : "",
      page_count: book.number_of_pages_median || "",
      language: book.language?.[0] || "",
      genres: (book.subject || []).slice(0, 5)
    })));
  }

  if (path === "/api/books" && method === "POST") {
    const input = cleanBook(await parseJson(request));
    const bookId = id("book");
    const timestamp = now();
    await db.prepare(`INSERT INTO books (
      id,title,subtitle,authors_json,cover_url,series_name,series_number,description,genres_json,format_metadata,isbn,publisher,publication_date,page_count,audiobook_runtime_seconds,narrators_json,language,personal_tags_json,favorite,status,book_dnf,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      bookId,input.title,input.subtitle,input.authors_json,input.cover_url,input.series_name,input.series_number,input.description,input.genres_json,input.format_metadata,input.isbn,input.publisher,input.publication_date,input.page_count,input.audiobook_runtime_seconds,input.narrators_json,input.language,input.personal_tags_json,input.favorite,input.status,input.book_dnf,timestamp,timestamp
    ).run();
    return json(decodeBook(await first(db, "SELECT * FROM books WHERE id = ?", bookId)), 201);
  }

  const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
  if (bookMatch && method === "PUT") {
    const raw = await parseJson(request);
    const bookId = bookMatch[1];
    const existingBook = await first(db, "SELECT cover_url FROM books WHERE id=?", bookId);
    if (!existingBook) throw new HttpError(404, "Book not found");
    if (raw.remove_cover) raw.cover_url = "";
    else if (!String(raw.cover_url || "").trim() && existingBook.cover_url) raw.cover_url = existingBook.cover_url;
    const input = cleanBook(raw);
    const result = await db.prepare(`UPDATE books SET title=?,subtitle=?,authors_json=?,cover_url=?,series_name=?,series_number=?,description=?,genres_json=?,format_metadata=?,isbn=?,publisher=?,publication_date=?,page_count=?,audiobook_runtime_seconds=?,narrators_json=?,language=?,personal_tags_json=?,favorite=?,status=?,book_dnf=?,updated_at=? WHERE id=?`).bind(
      input.title,input.subtitle,input.authors_json,input.cover_url,input.series_name,input.series_number,input.description,input.genres_json,input.format_metadata,input.isbn,input.publisher,input.publication_date,input.page_count,input.audiobook_runtime_seconds,input.narrators_json,input.language,input.personal_tags_json,input.favorite,input.status,input.book_dnf,now(),bookId
    ).run();
    if (!result.meta.changes) throw new HttpError(404, "Book not found");
    return json(decodeBook(await first(db, "SELECT * FROM books WHERE id = ?", bookId)));
  }

  if (path === "/api/reads" && method === "POST") {
    const input = await parseJson(request);
    if (!input.book_id) throw new HttpError(400, "Book is required");
    const active = await first(db, "SELECT id FROM read_throughs WHERE book_id=? AND state='active'", input.book_id);
    if (active) throw new HttpError(409, "This book already has an active read-through");
    const sequence = await first(db, "SELECT COALESCE(MAX(read_number),0) AS max_number FROM read_throughs WHERE book_id=?", input.book_id);
    const book = await first(db, "SELECT page_count,audiobook_runtime_seconds FROM books WHERE id=?", input.book_id);
    if (!book) throw new HttpError(404, "Book not found");
    const readId = id("read");
    const timestamp = now();
    const format = ["print", "ebook", "audiobook", "other"].includes(input.format) ? input.format : "print";
    const pageSnapshot = format === "print" || format === "ebook" || format === "other" ? book.page_count : null;
    const audioSnapshot = format === "audiobook" ? book.audiobook_runtime_seconds : null;
    await db.batch([
      db.prepare(`INSERT INTO read_throughs (id,book_id,read_number,start_date,state,format,starting_page,starting_percent,progress_page,progress_percent,listening_speed,notes,page_count_snapshot,audiobook_runtime_seconds_snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        readId,input.book_id,Number(sequence.max_number)+1,input.start_date || input.local_date,"active",format,input.starting_page ?? null,input.starting_percent ?? null,input.starting_page ?? null,input.starting_percent ?? null,Number(input.listening_speed || 1),String(input.notes || "").trim() || null,pageSnapshot,audioSnapshot,timestamp,timestamp
      ),
      db.prepare("UPDATE books SET status='reading',book_dnf=0,updated_at=? WHERE id=?").bind(timestamp,input.book_id)
    ]);
    return json(await first(db, "SELECT * FROM read_throughs WHERE id=?", readId), 201);
  }

  const readMatch = path.match(/^\/api\/reads\/([^/]+)$/);
  if (readMatch && method === "PUT") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", readMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    const state = ["active","finished","dnf"].includes(input.state) ? input.state : read.state;
    const format = ["print","ebook","audiobook","other"].includes(input.format) ? input.format : read.format;
    const startDate = String(input.start_date || "").trim();
    if (!startDate) throw new HttpError(400, "Start date is required");
    if (state === "active") {
      const conflict = await first(db, "SELECT id FROM read_throughs WHERE book_id=? AND state='active' AND id<>?", read.book_id, read.id);
      if (conflict) throw new HttpError(409, "This book already has another active read-through");
    }
    const finishDate = state === "active" ? null : String(input.finish_date || read.finish_date || "").trim() || null;
    const page = input.progress_page === "" || input.progress_page == null ? null : Math.max(0,Number(input.progress_page));
    const percent = input.progress_percent === "" || input.progress_percent == null ? null : Math.min(100,Math.max(0,Number(input.progress_percent)));
    const pageSnapshot = input.page_count_snapshot === "" || input.page_count_snapshot == null ? null : Math.max(0,Number(input.page_count_snapshot));
    const audioSnapshot = input.audiobook_runtime_seconds_snapshot === "" || input.audiobook_runtime_seconds_snapshot == null ? null : Math.max(0,Number(input.audiobook_runtime_seconds_snapshot));
    const timestamp = now();
    await db.prepare(`UPDATE read_throughs SET
      start_date=?,finish_date=?,state=?,format=?,progress_page=?,progress_percent=?,
      listening_speed=?,notes=?,page_count_snapshot=?,audiobook_runtime_seconds_snapshot=?,updated_at=?
      WHERE id=?`).bind(
        startDate,finishDate,state,format,page,percent,Number(input.listening_speed || 1),String(input.notes || "").trim() || null,pageSnapshot,audioSnapshot,timestamp,read.id
      ).run();
    await syncBookStatus(db, read.book_id, timestamp);
    return json(await first(db, "SELECT * FROM read_throughs WHERE id=?", read.id));
  }

  if (readMatch && method === "DELETE") {
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", readMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    await db.batch([
      db.prepare("DELETE FROM reading_sessions WHERE read_id=?").bind(read.id),
      db.prepare("DELETE FROM daily_checkins WHERE read_id=?").bind(read.id),
      db.prepare("DELETE FROM read_throughs WHERE id=?").bind(read.id)
    ]);
    await syncBookStatus(db, read.book_id);
    return json({ ok:true, deleted_read_id:read.id, book_id:read.book_id });
  }

  const progressMatch = path.match(/^\/api\/reads\/([^/]+)\/progress$/);
  if (progressMatch && method === "PUT") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", progressMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    const page = input.page === "" || input.page == null ? read.progress_page : Math.max(0, Number(input.page));
    const percent = input.percent === "" || input.percent == null ? read.progress_percent : Math.min(100, Math.max(0, Number(input.percent)));
    const speed = Math.max(0.05, Number(input.listening_speed || read.listening_speed || 1));
    const timestamp = now();
    let inferredSeconds = 0;
    let timerCovered = false;
    let coveredSeconds = 0;
    if (read.format === "audiobook" && percent > Number(read.progress_percent ?? read.starting_percent ?? 0)) {
      const book = await first(db, "SELECT audiobook_runtime_seconds FROM books WHERE id=?", read.book_id);
      const runtime = Number(read.audiobook_runtime_seconds_snapshot || book?.audiobook_runtime_seconds || 0);
      if (runtime > 0) {
        const expectedSeconds = Math.max(1, Math.round(runtime * (percent - Number(read.progress_percent ?? read.starting_percent ?? 0)) / 100 / speed));
        const coverageStart = new Date(read.updated_at || read.created_at || timestamp);
        const relevantSessions = await all(db, `SELECT started_at, ended_at, duration_seconds FROM reading_sessions
          WHERE read_id=? AND (ended_at IS NULL OR ended_at>?)
          ORDER BY started_at`, read.id, coverageStart.toISOString());
        const coverageEnd = new Date(timestamp);
        coveredSeconds = 0;
        for (const session of relevantSessions) {
          const sessionStart = new Date(session.started_at);
          const sessionEnd = session.ended_at ? new Date(session.ended_at) : coverageEnd;
          const overlapStart = sessionStart > coverageStart ? sessionStart : coverageStart;
          const overlapEnd = sessionEnd < coverageEnd ? sessionEnd : coverageEnd;
          if (overlapEnd > overlapStart) coveredSeconds += Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 1000));
        }
        timerCovered = coveredSeconds > 0;
        inferredSeconds = Math.max(0, expectedSeconds - coveredSeconds);
      }
    }
    const updates = [db.prepare("UPDATE read_throughs SET progress_page=?, progress_percent=?, listening_speed=?, updated_at=? WHERE id=?").bind(page,percent,speed,timestamp,read.id)];
    if (inferredSeconds) {
      const endedAt = timestamp;
      const startedAt = new Date(new Date(endedAt).getTime() - inferredSeconds * 1000).toISOString();
      updates.push(db.prepare("INSERT INTO reading_sessions (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,listening_speed,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(
        id("session"),read.id,read.book_id,input.local_date || endedAt.slice(0,10),startedAt,endedAt,inferredSeconds,speed,timestamp
      ));
    }
    await db.batch(updates);
    const updated = await first(db, "SELECT * FROM read_throughs WHERE id=?", read.id);
    return json({ ...updated, inferred_duration_seconds:inferredSeconds, timer_covered:timerCovered, timer_covered_seconds:coveredSeconds || 0 });
  }

  const finishMatch = path.match(/^\/api\/reads\/([^/]+)\/(finish|dnf)$/);
  if (finishMatch && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", finishMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    const state = finishMatch[2] === "finish" ? "finished" : "dnf";
    const timestamp = now();
    await db.prepare("UPDATE read_throughs SET state=?,finish_date=?,final_page=COALESCE(?,progress_page),final_percent=COALESCE(?,progress_percent),progress_percent=CASE WHEN ?='finished' THEN 100 ELSE progress_percent END,updated_at=? WHERE id=?").bind(state,input.finish_date || input.local_date,input.page ?? null,input.percent ?? null,state,timestamp,read.id).run();
    await syncBookStatus(db, read.book_id, timestamp);
    return json({ ok: true });
  }

  if (path === "/api/sessions/start" && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=? AND state='active'", input.read_id);
    if (!read) throw new HttpError(404, "Active read-through not found");
    const existing = await first(db, "SELECT * FROM reading_sessions WHERE ended_at IS NULL");
    if (existing) throw new HttpError(409, "Another reading timer is already running");
    const startedAt = input.started_at || now();
    const sessionId = id("session");
    await db.prepare("INSERT INTO reading_sessions (id,read_id,book_id,local_date,started_at,listening_speed,created_at) VALUES (?,?,?,?,?,?,?)").bind(sessionId,read.id,read.book_id,input.local_date,startedAt,read.format === "audiobook" ? Number(read.listening_speed || 1) : null,now()).run();
    return json(await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionId), 201);
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "PUT") {
    const input = await parseJson(request);
    const session = await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionMatch[1]);
    if (!session) throw new HttpError(404, "Session not found");
    if (!session.ended_at) throw new HttpError(409, "Stop this timer before editing or moving the session");

    let readId = session.read_id;
    let bookId = session.book_id;
    if (input.read_id && input.read_id !== session.read_id) {
      const destination = await first(db, "SELECT id,book_id FROM read_throughs WHERE id=?", input.read_id);
      if (!destination) throw new HttpError(404, "Destination read-through not found");
      readId = destination.id;
      bookId = destination.book_id;
    }

    const localDate = input.local_date == null ? session.local_date : String(input.local_date).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new HttpError(400, "Session date must be YYYY-MM-DD");

    const startedAt = input.started_at == null ? session.started_at : String(input.started_at);
    let endedAt = input.ended_at == null ? session.ended_at : String(input.ended_at);
    const startDate = new Date(startedAt);
    let endDate = new Date(endedAt);
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, "Invalid session start time");

    let duration = Number(session.duration_seconds || 0);
    if (input.duration_seconds != null && input.duration_seconds !== "") {
      duration = Math.max(0, Math.round(Number(input.duration_seconds)));
      if (!Number.isFinite(duration)) throw new HttpError(400, "Invalid session duration");
      endDate = new Date(startDate.getTime() + duration * 1000);
      endedAt = endDate.toISOString();
    } else {
      if (Number.isNaN(endDate.getTime()) || endDate < startDate) throw new HttpError(400, "Session end must be after session start");
      duration = durationSeconds(startDate, endDate);
    }

    let listeningSpeed = session.listening_speed;
    if (input.listening_speed !== undefined) {
      if (input.listening_speed === null || input.listening_speed === "") listeningSpeed = null;
      else {
        listeningSpeed = Number(input.listening_speed);
        if (!Number.isFinite(listeningSpeed) || listeningSpeed <= 0) throw new HttpError(400, "Listening speed must be greater than zero");
      }
    }

    await db.prepare(`UPDATE reading_sessions SET
      read_id=?,book_id=?,local_date=?,started_at=?,ended_at=?,duration_seconds=?,listening_speed=?
      WHERE id=?`).bind(readId,bookId,localDate,startedAt,endedAt,duration,listeningSpeed,session.id).run();
    return json(await first(db, "SELECT * FROM reading_sessions WHERE id=?", session.id));
  }

  if (sessionMatch && method === "DELETE") {
    const session = await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionMatch[1]);
    if (!session) throw new HttpError(404, "Session not found");
    if (!session.ended_at) throw new HttpError(409, "Stop this timer before deleting the session");
    await db.prepare("DELETE FROM reading_sessions WHERE id=?").bind(session.id).run();
    return json({ ok:true, deleted_session_id:session.id });
  }

  const stopMatch = path.match(/^\/api\/sessions\/([^/]+)\/stop$/);
  if (stopMatch && method === "POST") {
    const input = await parseJson(request);
    const session = await first(db, "SELECT * FROM reading_sessions WHERE id=?", stopMatch[1]);
    if (!session) throw new HttpError(404, "Session not found");
    if (session.ended_at) return json(session);
    const endedAt = input.ended_at || now();
    await db.prepare("UPDATE reading_sessions SET ended_at=?,duration_seconds=? WHERE id=?").bind(endedAt,durationSeconds(session.started_at,endedAt),session.id).run();
    return json(await first(db, "SELECT * FROM reading_sessions WHERE id=?", session.id));
  }

  if (path === "/api/checkins" && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", input.read_id);
    if (!read) throw new HttpError(404, "Read-through not found");
    const newPage = input.page === "" || input.page == null ? read.progress_page : Number(input.page);
    const newPercent = input.percent === "" || input.percent == null ? read.progress_percent : Number(input.percent);
    const pagesRead = newPage != null && read.progress_page != null ? Math.max(0, newPage - read.progress_page) : 0;
    const timestamp = now();
    await db.batch([
      db.prepare("INSERT INTO daily_checkins (id,read_id,book_id,session_date,previous_page,new_page,previous_percent,new_percent,pages_read,listening_speed,reconciled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id("checkin"),read.id,read.book_id,input.session_date,read.progress_page,newPage,read.progress_percent,newPercent,pagesRead,input.listening_speed ?? read.listening_speed,timestamp),
      db.prepare("UPDATE read_throughs SET progress_page=?,progress_percent=?,listening_speed=?,updated_at=? WHERE id=?").bind(newPage,newPercent,Number(input.listening_speed || read.listening_speed || 1),timestamp,read.id)
    ]);
    return json({ ok: true });
  }

  if (path === "/api/goals/daily" && method === "POST") {
    const input = await parseJson(request);
    if (!["minutes", "pages"].includes(input.goal_type) || Number(input.amount) <= 0) throw new HttpError(400, "Choose a valid daily goal");
    await db.prepare("INSERT INTO goal_history (id,effective_date,goal_type,amount,paused,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(effective_date) DO UPDATE SET goal_type=excluded.goal_type,amount=excluded.amount,paused=excluded.paused").bind(id("goal"),input.effective_date,input.goal_type,Number(input.amount),input.paused?1:0,now()).run();
    return json({ ok: true });
  }

  if (path === "/api/goals/annual" && method === "POST") {
    const input = await parseJson(request);
    await db.prepare("INSERT INTO annual_goals (year,target_books,count_rereads,updated_at) VALUES (?,?,?,?) ON CONFLICT(year) DO UPDATE SET target_books=excluded.target_books,count_rereads=excluded.count_rereads,updated_at=excluded.updated_at").bind(Number(input.year),Math.max(1,Number(input.target_books)),input.count_rereads?1:0,now()).run();
    return json({ ok: true });
  }

  if (path === "/api/shelves" && method === "POST") {
    const input = await parseJson(request);
    const name = String(input.name || "").trim();
    if (!name) throw new HttpError(400, "Shelf name is required");
    const shelfId = id("shelf");
    await db.prepare("INSERT INTO custom_shelves (id,name,created_at,updated_at) VALUES (?,?,?,?)").bind(shelfId,name,now(),now()).run();
    return json(await first(db, "SELECT * FROM custom_shelves WHERE id=?", shelfId), 201);
  }

  const shelfMatch = path.match(/^\/api\/shelves\/([^/]+)$/);
  if (shelfMatch && method === "PUT") {
    const input = await parseJson(request);
    await db.prepare("UPDATE custom_shelves SET name=?,updated_at=? WHERE id=?").bind(String(input.name || "").trim(),now(),shelfMatch[1]).run();
    return json({ ok: true });
  }
  if (shelfMatch && method === "DELETE") {
    await db.prepare("DELETE FROM custom_shelves WHERE id=?").bind(shelfMatch[1]).run();
    return json({ ok: true });
  }

  const membershipMatch = path.match(/^\/api\/shelves\/([^/]+)\/books\/([^/]+)$/);
  if (membershipMatch && method === "PUT") {
    await db.prepare("INSERT OR IGNORE INTO shelf_books (shelf_id,book_id,sort_order,added_at) VALUES (?,?,?,?)").bind(membershipMatch[1],membershipMatch[2],Date.now(),now()).run();
    return json({ ok: true });
  }
  if (membershipMatch && method === "DELETE") {
    await db.prepare("DELETE FROM shelf_books WHERE shelf_id=? AND book_id=?").bind(membershipMatch[1],membershipMatch[2]).run();
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request, env);
      if (url.pathname.startsWith("/api/")) return cors(await handleApi(request, env, url), request, env);
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, app: "Opal Shelf API", version: "0.0.9" });
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      console.error(error);
      return url.pathname.startsWith("/api/")
        ? cors(json({ error: error.message || "Unexpected error" }, error.status || 500), request, env)
        : json({ error: error.message || "Unexpected error" }, error.status || 500);
    }
  }
};
