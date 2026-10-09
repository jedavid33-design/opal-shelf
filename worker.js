// Opal Shelf Worker v0.0.40 is intentionally self-contained for Cloudflare's
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
    book_dnf: Boolean(row.book_dnf),
    widget_featured: Boolean(row.widget_featured)
  };
}

function cleanBook(input) {
  const title = String(input.title || "").trim();
  if (!title) throw new HttpError(400, "Title is required");
  const list = (value) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  // m6: garbage numeric input must coerce to null, never NaN (D1 rejects NaN binds).
  const numOrNull = (value) => (value === "" || value == null) ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const nonNegOrNull = (value) => { const n = numOrNull(value); return n == null ? null : Math.max(0, n); };
  return {
    title,
    subtitle: String(input.subtitle || "").trim() || null,
    authors_json: JSON.stringify(list(input.authors)),
    cover_url: String(input.cover_url || "").trim() || null,
    series_name: String(input.series_name || "").trim() || null,
    series_number: numOrNull(input.series_number),
    description: String(input.description || "").trim() || null,
    genres_json: JSON.stringify(list(input.genres)),
    format_metadata: String(input.format_metadata || "").trim() || null,
    isbn: String(input.isbn || "").trim() || null,
    asin: String(input.asin || "").trim().toUpperCase() || null,
    publisher: String(input.publisher || "").trim() || null,
    publication_date: String(input.publication_date || "").trim() || null,
    page_count: nonNegOrNull(input.page_count),
    audiobook_runtime_seconds: nonNegOrNull(input.audiobook_runtime_seconds),
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
    SUM(CASE WHEN state IN ('active','paused') THEN 1 ELSE 0 END) AS active_count,
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


async function ensureReadStatePeriods(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS read_state_periods (
    id TEXT PRIMARY KEY,
    read_id TEXT NOT NULL,
    state TEXT NOT NULL,
    started_date TEXT NOT NULL,
    ended_date TEXT,
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_read_state_periods_read ON read_state_periods(read_id,started_date)").run();

  // Backfill one best-known period for existing reads. Historical pauses/DNF gaps
  // from before this release cannot be reconstructed if they were never recorded.
  // m2: single-statement INSERT..WHERE NOT EXISTS so concurrent bootstraps
  // cannot double-insert. (No UNIQUE index: 4 pre-v0.0.27 duplicate pairs
  // remain in production and are Julie's call to remove; the active-day math
  // in bootstrap() merges overlapping same-state periods instead.)
  const missing=await all(db, `SELECT rt.id,rt.state,rt.start_date,rt.finish_date,rt.created_at
    FROM read_throughs rt
    LEFT JOIN read_state_periods rsp ON rsp.read_id=rt.id
    WHERE rsp.id IS NULL`);
  for(const read of missing) {
    const historicalState=read.state==="active" ? "active" : read.state;
    await db.prepare(`INSERT INTO read_state_periods (id,read_id,state,started_date,ended_date,created_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM read_state_periods WHERE read_id=?)`)
      .bind(id("state"),read.id,historicalState,read.start_date,
        read.state==="active" ? null : (read.finish_date||read.start_date),
        read.created_at||now(),read.id).run();
  }
}

async function recordReadStateChange(db, read, nextState, changeDate) {
  await ensureReadStatePeriods(db);
  const current=await first(db,"SELECT * FROM read_state_periods WHERE read_id=? AND ended_date IS NULL ORDER BY started_date DESC LIMIT 1",read.id);
  if(current && current.state===nextState)return;
  if(current)await db.prepare("UPDATE read_state_periods SET ended_date=? WHERE id=?").bind(changeDate,current.id).run();
  await db.prepare("INSERT INTO read_state_periods (id,read_id,state,started_date,ended_date,created_at) VALUES (?,?,?,?,?,?)")
    .bind(id("state"),read.id,nextState,changeDate,null,now()).run();
}

function inclusiveDays(start,end) {
  const a=new Date(`${start}T00:00:00Z`),b=new Date(`${end}T00:00:00Z`);
  if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime())||b<a)return 0;
  return Math.floor((b-a)/86400000)+1;
}

async function bootstrap(db, url) {
  const today = url.searchParams.get("date") || localDateKey();
  await ensureReadStatePeriods(db);
  const [bookRows, reads, sessions, goals, annualGoals, shelves, memberships, checkins, statePeriods] = await Promise.all([
    all(db, "SELECT * FROM books ORDER BY favorite DESC, title COLLATE NOCASE"),
    all(db, "SELECT * FROM read_throughs ORDER BY created_at DESC"),
    all(db, "SELECT * FROM reading_sessions ORDER BY started_at DESC"),
    all(db, "SELECT * FROM goal_history ORDER BY effective_date"),
    all(db, "SELECT * FROM annual_goals ORDER BY year DESC"),
    all(db, "SELECT * FROM custom_shelves ORDER BY name COLLATE NOCASE"),
    all(db, "SELECT * FROM shelf_books ORDER BY sort_order, added_at"),
    all(db, "SELECT * FROM daily_checkins ORDER BY session_date DESC"),
    all(db, "SELECT * FROM read_state_periods ORDER BY started_date")
  ]);
  const books = bookRows.map(decodeBook);
  for (const read of reads) {
    // Overlapping same-state periods (pre-v0.0.27 double-inserts) are merged
    // so days are never double-counted. Data itself is untouched.
    read.active_days = mergeDateRanges(statePeriods
      .filter((period)=>period.read_id===read.id && period.state==="active")
      .map((period)=>[period.started_date, period.ended_date || today]))
      .reduce((sum,[start,end])=>sum+inclusiveDays(start,end),0);
  }
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
    statePeriods,
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

// Lightweight endpoint for the iOS Widgy "Currently Reading" widget.
// Returns books with status='reading' plus progress and today's activity.
async function widgetCurrentlyReading(db, url) {
  // Widgy does not send the app's local date. Cloudflare runs in UTC, which
  // rolled the widget to tomorrow at 8 PM Eastern and made today's minutes 0.
  const today = url.searchParams.get("date") || localDateKey(new Date(), "America/New_York");
  const bookRows = await all(db, "SELECT * FROM books WHERE widget_featured=1 ORDER BY updated_at DESC LIMIT 1");
  const books = [];
  for (const row of bookRows) {
    const book = decodeBook(row);
    const read = await first(db,
      "SELECT * FROM read_throughs WHERE book_id=? AND state='active' ORDER BY updated_at DESC", book.id);
    let secondsToday = 0, pagesToday = 0;
    if (read) {
      const s = await first(db,
        "SELECT SUM(duration_seconds) AS total FROM reading_sessions WHERE read_id=? AND local_date=? AND ended_at IS NOT NULL",
        read.id, today);
      secondsToday = Number(s?.total || 0);
      const c = await first(db,
        "SELECT SUM(pages_read) AS total FROM daily_checkins WHERE read_id=? AND session_date=?",
        read.id, today);
      pagesToday = Number(c?.total || 0);
    }
    const authors = book.authors || [];
    books.push({
      id: book.id,
      title: book.title || "",
      author: typeof authors[0] === "string" ? authors[0] : (authors[0]?.name || ""),
      cover_url: book.cover_url || "",
      progress_percent: read?.progress_percent ?? null,
      progress_page: read?.progress_page ?? null,
      page_count: book.page_count || read?.page_count_snapshot || null,
      seconds_today: secondsToday,
      pages_today: pagesToday,
    });
  }
  const [goals, sessions, checkins] = await Promise.all([
    all(db, "SELECT * FROM goal_history ORDER BY effective_date"),
    all(db, "SELECT * FROM reading_sessions WHERE ended_at IS NOT NULL ORDER BY started_at"),
    all(db, "SELECT * FROM daily_checkins ORDER BY session_date")
  ]);
  const activity = {};
  for (const session of sessions) {
    activity[session.local_date] ||= { seconds: 0, pages: 0 };
    activity[session.local_date].seconds += Number(session.duration_seconds || 0);
  }
  for (const checkin of checkins) {
    activity[checkin.session_date] ||= { seconds: 0, pages: 0 };
    activity[checkin.session_date].pages += Number(checkin.pages_read || 0);
  }
  const streak = computeStreak(goals, activity, today);
  // All completed sessions for the date, across every book/read-through,
  // using the same aggregate (including correction rows) as the dashboard.
  const totalSecondsToday = Math.max(0, Number(activity[today]?.seconds || 0));
  return { today, books, streak, total_seconds_today: totalSecondsToday };
}


function escapeWidgetHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function widgetCurrentlyReadingPage(db, url) {
  const data = await widgetCurrentlyReading(db, url);
  const book = data.books[0] || null;
  const title = escapeWidgetHtml(book?.title || "No book selected");
  const author = escapeWidgetHtml(book?.author || "");
  const cover = escapeWidgetHtml(book?.cover_url || "");
  const percentValue = book?.progress_percent == null ? null : Math.max(0, Math.min(100, Math.round(Number(book.progress_percent))));
  const percent = percentValue == null ? "—" : percentValue + "%";
  const minutes = Math.max(0, Math.round(Number(data.total_seconds_today || 0) / 60));
  const timeLabel = minutes + " min today";
  const streakDays = Math.max(0, Number(data.streak?.current || 0));
  const streakLabel = streakDays + " day" + (streakDays === 1 ? "" : "s") + " streak";

  const body = book ? `
    <main class="widget">
      <header>CURRENTLY READING</header>
      <section class="content">
        <div class="cover-wrap">
          ${cover ? `<img class="cover" src="${cover}" alt="">` : `<div class="cover placeholder"></div>`}
        </div>
        <div class="details">
          <div class="title">${title}</div>
          <div class="author">${author}</div>
          <div class="progress">${percent}</div>
          <div class="today"><span>${timeLabel}</span></div>
          <div class="streak">🔥 ${streakLabel}</div>
        </div>
      </section>
    </main>` : `
    <main class="widget empty">
      <header>CURRENTLY READING</header>
      <div class="empty-copy">Choose “Show in widget” on a book in Opal Shelf.</div>
    </main>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eee6f1}
  body{font-family:"Avenir Next",Avenir,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#552048}
  .widget{
    width:100vw;height:100vw;position:relative;overflow:hidden;padding:6.5% 7.5% 7.5%;
    background:
      radial-gradient(circle at 13% 15%,rgba(255,222,239,.92),transparent 31%),
      radial-gradient(circle at 84% 17%,rgba(195,226,255,.88),transparent 32%),
      radial-gradient(circle at 76% 82%,rgba(202,238,232,.72),transparent 35%),
      radial-gradient(circle at 18% 82%,rgba(255,218,196,.78),transparent 34%),
      radial-gradient(circle at 52% 53%,rgba(218,205,244,.82),transparent 42%),
      linear-gradient(145deg,#f3e9f6 0%,#dce8f6 48%,#f4dfe7 100%);
  }
  .widget:before,.widget:after{content:"";position:absolute;inset:-20%;pointer-events:none}
  .widget:before{
    opacity:.30;
    background:
      linear-gradient(115deg,transparent 30%,rgba(255,255,255,.75) 42%,transparent 54%),
      linear-gradient(25deg,transparent 37%,rgba(191,232,245,.55) 50%,transparent 63%);
    transform:rotate(-7deg);
  }
  header{
    position:relative;z-index:1;text-align:center;font-weight:700;letter-spacing:.035em;
    font-size:clamp(22px,6.4vw,48px);line-height:1.05;white-space:nowrap;
  }
  .content{
    position:relative;z-index:1;height:calc(100% - 13%);display:grid;
    grid-template-columns:44% 1fr;gap:7%;align-items:center;padding-top:2%;
  }
  .cover-wrap{display:flex;align-items:center;justify-content:center;width:100%}
  .cover{
    display:block;width:100%;max-height:70vh;object-fit:contain;border-radius:4.5%;
    box-shadow:0 3px 10px rgba(62,31,67,.18);
  }
  .placeholder{aspect-ratio:2/3;background:rgba(255,255,255,.35);border-radius:4.5%}
  .details{min-width:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
  .title{font-size:clamp(24px,8.2vw,58px);line-height:1.02;font-weight:700;max-width:100%;overflow-wrap:anywhere}
  .author{font-size:clamp(15px,4.4vw,32px);line-height:1.12;font-weight:500;margin-top:4%;opacity:.88;max-width:100%;overflow-wrap:anywhere}
  .progress{font-size:clamp(50px,15vw,104px);line-height:.95;font-weight:700;margin-top:12%;letter-spacing:-.035em}
  .today{display:flex;align-items:center;gap:.38em;font-size:clamp(18px,5.4vw,38px);font-weight:600;margin-top:8%;white-space:nowrap}
  .streak{font-size:clamp(17px,4.8vw,34px);font-weight:600;margin-top:4%;white-space:nowrap;opacity:.95}
  .empty{display:flex;flex-direction:column;align-items:center}
  .empty-copy{position:relative;z-index:1;margin:auto;text-align:center;font-size:clamp(18px,5vw,34px);font-weight:500;max-width:78%}
</style>
</head>
<body>${body}</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "pragma": "no-cache",
      "expires": "0"
    }
  });
}

async function pendingCheckins(db, date) {
  await ensureReadStatePeriods(db);
  const yesterday = new Date(`${date}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const yesterdayKey=yesterday.toISOString().slice(0,10);

  // Always reconcile every read-through that was active yesterday, even if the
  // timer was never started. Older unreconciled timed sessions are retained too.
  // Finished and DNF read-throughs are never asked about: the reconciliation
  // is only for currently-reading books.
  return all(db, `
    WITH candidates AS (
      SELECT DISTINCT rt.id AS read_id, rt.book_id, ? AS session_date
      FROM read_throughs rt
      JOIN read_state_periods rsp ON rsp.read_id=rt.id
      WHERE rsp.state='active'
        AND rsp.started_date<=?
        AND (rsp.ended_date IS NULL OR rsp.ended_date>=?)
      UNION
      SELECT DISTINCT rs.read_id, rs.book_id, rs.local_date AS session_date
      FROM reading_sessions rs
      JOIN read_throughs historical_rt ON historical_rt.id=rs.read_id
      WHERE rs.local_date<? AND rs.ended_at IS NOT NULL
        AND historical_rt.state IN ('active','paused')
    )
    SELECT c.read_id,c.book_id,c.session_date,
      COUNT(rs.id) AS session_count,COALESCE(SUM(rs.duration_seconds),0) AS duration_seconds,
      b.title,b.page_count,b.audiobook_runtime_seconds,
      rt.format,rt.progress_page,rt.progress_percent,rt.listening_speed,
      rt.page_count_snapshot,rt.audiobook_runtime_seconds_snapshot
    FROM candidates c
    JOIN books b ON b.id=c.book_id
    JOIN read_throughs rt ON rt.id=c.read_id
    LEFT JOIN reading_sessions rs ON rs.read_id=c.read_id AND rs.local_date=c.session_date AND rs.ended_at IS NOT NULL
    LEFT JOIN daily_checkins dc ON dc.read_id=c.read_id AND dc.session_date=c.session_date
    WHERE dc.id IS NULL
      AND rt.state IN ('active','paused')
    GROUP BY c.read_id,c.book_id,c.session_date
    ORDER BY c.session_date,b.title COLLATE NOCASE
  `, yesterdayKey,yesterdayKey,yesterdayKey,date);
}


async function ensureBookAsin(db) {
  const columns = await all(db, "PRAGMA table_info(books)");
  if (!columns.some((column)=>column.name==="asin")) {
    await db.prepare("ALTER TABLE books ADD COLUMN asin TEXT").run();
  }
}

// Wall-clock date of an ISO timestamp in the zone its own offset designates.
// "2026-10-01T14:30:00-04:00" -> "2026-10-01"; bare "Z"/offset-less -> UTC date.
function dateKeyInOffset(iso) {
  const text = String(iso || "");
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const match = text.match(/([+-])(\d{2}):?(\d{2})\s*$/);
  if (!match) return date.toISOString().slice(0, 10);
  const offsetMinutes = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return new Date(date.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
}

// One-time, idempotent schema migrations. Never modifies existing row values:
// ADD COLUMN / CREATE INDEX only, plus a read_throughs table rebuild that
// copies every row verbatim to widen the CHECK constraints (M3).
async function ensureSchema(db) {
  await ensureBookAsin(db);

  const sessionColumns = await all(db, "PRAGMA table_info(reading_sessions)");
  const hasSessionColumn = (name) => sessionColumns.some((column) => column.name === name);
  const columnMigrations = [];
  // M1: stable client id for idempotent session ingest.
  if (!hasSessionColumn("client_session_id")) columnMigrations.push("ALTER TABLE reading_sessions ADD COLUMN client_session_id TEXT");
  // M5/m7: provenance for inferred estimates and their corrections.
  if (!hasSessionColumn("source")) columnMigrations.push("ALTER TABLE reading_sessions ADD COLUMN source TEXT");
  if (!hasSessionColumn("adjusts_session_id")) columnMigrations.push("ALTER TABLE reading_sessions ADD COLUMN adjusts_session_id TEXT");
  for (const sql of columnMigrations) await db.prepare(sql).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_sessions_client_session_id ON reading_sessions(client_session_id)").run();

  // Uploaded covers live outside the books row so bootstrap stays small. The
  // public cover route exposes only opaque book-id image bytes, never library metadata.
  await db.prepare(`CREATE TABLE IF NOT EXISTS book_cover_assets (
    book_id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();

  // Widget featured flag: Julie checks books in Shelf to show them in the iOS Widgy widget.
  const bookColumns = await all(db, "PRAGMA table_info(books)");
  if (!bookColumns.some((c) => c.name === "widget_featured")) {
    await db.prepare("ALTER TABLE books ADD COLUMN widget_featured INTEGER NOT NULL DEFAULT 0").run();
  }

  // M3: admit 'paused' state and 'other' format so the UI options the app
  // offers stop 500ing on the D1 CHECK constraints. SQLite cannot ALTER a
  // CHECK, so the table must be rebuilt — but D1 always enforces foreign
  // keys and ignores PRAGMA foreign_keys=OFF / legacy_alter_table, so
  // read_throughs cannot be dropped while reading_sessions / daily_checkins
  // reference it. Rebuild order: (A) children without the read_throughs FK,
  // (B) read_throughs with widened CHECKs, (C) children with the FK restored.
  // Every step is check-then-act, so an interrupted migration resumes
  // cleanly; rows are copied verbatim and never modified.
  const tableSql = async (name) =>
    (await first(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", name))?.sql || "";

  // Rebuild `name` from `createSql` via a staging table, verifying the copy
  // before dropping the original. Crash-safe: a leftover staging table is
  // either discarded (original intact) or adopted (original already dropped).
  const rebuildTable = async (db, name, createSql, columns, indexSqls) => {
    const staging = `${name}_rebuild_new`;
    const stagingExists = await first(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", staging);
    const mainExists = await first(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name);
    if (stagingExists && mainExists) await db.prepare(`DROP TABLE ${staging}`).run();
    else if (stagingExists && !mainExists) {
      await db.prepare(`ALTER TABLE ${staging} RENAME TO ${name}`).run();
      for (const idx of indexSqls) await db.prepare(idx).run();
      return;
    } else if (!mainExists) {
      throw new Error(`Migration cannot rebuild missing table ${name}`);
    }
    await db.prepare(createSql.replace(name, staging)).run();
    const cols = columns.join(",");
    await db.prepare(`INSERT INTO ${staging} (${cols}) SELECT ${cols} FROM ${name}`).run();
    const newCount = (await first(db, `SELECT COUNT(*) AS n FROM ${staging}`))?.n;
    const oldCount = (await first(db, `SELECT COUNT(*) AS n FROM ${name}`))?.n;
    if (newCount !== oldCount) throw new Error(`Migration copy mismatch on ${name}: ${oldCount} -> ${newCount}`);
    await db.prepare(`DROP TABLE ${name}`).run();
    await db.prepare(`ALTER TABLE ${staging} RENAME TO ${name}`).run();
    for (const idx of indexSqls) await db.prepare(idx).run();
  };

  const RS_COLUMNS = ["id","read_id","book_id","local_date","started_at","ended_at","duration_seconds","created_at","listening_speed","client_session_id","source","adjusts_session_id"];
  const RS_INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer ON reading_sessions((1)) WHERE ended_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_sessions_date ON reading_sessions(local_date)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_read_date ON reading_sessions(read_id, local_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_sessions_client_session_id ON reading_sessions(client_session_id)",
  ];
  const readingSessionsSql = (withReadThroughFk) => `CREATE TABLE reading_sessions (
        id TEXT PRIMARY KEY,
        read_id TEXT NOT NULL${withReadThroughFk ? " REFERENCES read_throughs(id) ON DELETE RESTRICT" : ""},
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
        local_date TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER,
        created_at TEXT NOT NULL,
        listening_speed REAL,
        client_session_id TEXT,
        source TEXT,
        adjusts_session_id TEXT
      )`;
  const DC_COLUMNS = ["id","read_id","book_id","session_date","previous_page","new_page","previous_percent","new_percent","pages_read","listening_speed","reconciled_at"];
  const dailyCheckinsSql = (withReadThroughFk) => `CREATE TABLE daily_checkins (
        id TEXT PRIMARY KEY,
        read_id TEXT NOT NULL${withReadThroughFk ? " REFERENCES read_throughs(id) ON DELETE RESTRICT" : ""},
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
        session_date TEXT NOT NULL,
        previous_page INTEGER,
        new_page INTEGER,
        previous_percent REAL,
        new_percent REAL,
        pages_read INTEGER NOT NULL DEFAULT 0,
        listening_speed REAL,
        reconciled_at TEXT NOT NULL,
        UNIQUE(read_id, session_date)
      )`;
  const RT_COLUMNS = ["id","book_id","read_number","start_date","finish_date","state","format","starting_page","starting_percent","progress_page","progress_percent","final_page","final_percent","listening_speed","created_at","updated_at","notes","page_count_snapshot","audiobook_runtime_seconds_snapshot"];
  const RT_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_reads_book ON read_throughs(book_id, read_number)",
    "CREATE INDEX IF NOT EXISTS idx_reads_state ON read_throughs(state)",
  ];
  const readThroughsWidenedSql = `CREATE TABLE read_throughs (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
        read_number INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        finish_date TEXT,
        state TEXT NOT NULL CHECK (state IN ('active','paused','finished','dnf')),
        format TEXT NOT NULL CHECK (format IN ('print','ebook','audiobook','other')),
        starting_page INTEGER,
        starting_percent REAL,
        progress_page INTEGER,
        progress_percent REAL,
        final_page INTEGER,
        final_percent REAL,
        listening_speed REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        notes TEXT,
        page_count_snapshot INTEGER,
        audiobook_runtime_seconds_snapshot INTEGER,
        UNIQUE(book_id, read_number)
      )`;

  // Phase A/B: widen the parent CHECKs, detaching children first.
  if (!(await tableSql("read_throughs")).includes("'paused'")) {
    if ((await tableSql("reading_sessions")).includes("REFERENCES read_throughs")) {
      await rebuildTable(db, "reading_sessions", readingSessionsSql(false), RS_COLUMNS, RS_INDEXES);
    }
    if ((await tableSql("daily_checkins")).includes("REFERENCES read_throughs")) {
      await rebuildTable(db, "daily_checkins", dailyCheckinsSql(false), DC_COLUMNS, []);
    }
    await rebuildTable(db, "read_throughs", readThroughsWidenedSql, RT_COLUMNS, RT_INDEXES);
  }
  // Phase C: restore the child FKs once the parent is widened.
  if ((await tableSql("read_throughs")).includes("'paused'")) {
    if (!(await tableSql("reading_sessions")).includes("REFERENCES read_throughs")) {
      await rebuildTable(db, "reading_sessions", readingSessionsSql(true), RS_COLUMNS, RS_INDEXES);
    }
    if (!(await tableSql("daily_checkins")).includes("REFERENCES read_throughs")) {
      await rebuildTable(db, "daily_checkins", dailyCheckinsSql(true), DC_COLUMNS, []);
    }
  }
}

// Insert one negative adjustment row against a single inferred estimate row,
// voiding `seconds` of it. Never voids more than the row's un-voided remainder.
// Existing rows are never modified, merged, or deleted.
async function insertAdjustment(db, inferredRow, seconds, localDate, intervalStart = null, intervalEnd = null) {
  const already = await first(db, `SELECT COALESCE(SUM(-duration_seconds),0) AS voided FROM reading_sessions WHERE adjusts_session_id=? AND source='adjustment'`, inferredRow.id);
  const remaining = Math.max(0, Number(inferredRow.duration_seconds || 0) - Number(already?.voided || 0));
  const voidSeconds = Math.min(Math.round(seconds), remaining);
  if (voidSeconds <= 0) return null;
  const adjId = id("session");
  await db.prepare(`INSERT INTO reading_sessions
    (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,client_session_id,source,adjusts_session_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    adjId, inferredRow.read_id, inferredRow.book_id, localDate,
    intervalStart || inferredRow.started_at, intervalEnd || inferredRow.ended_at,
    -voidSeconds, null, "adjustment", inferredRow.id, now()).run();
  return { adjustment_id: adjId, inferred_session_id: inferredRow.id, seconds: voidSeconds };
}

// M5: a late-arriving real session overlapping an inferred estimate voids the
// overlapping portion via adjustment rows (see insertAdjustment).
async function voidInferredOverlap(db, session) {
  if (!session || !session.ended_at) return { adjusted_seconds: 0, adjustments: [] };
  const inferred = await all(db, `SELECT * FROM reading_sessions WHERE read_id=? AND source='inferred' AND id<>? AND ended_at IS NOT NULL`, session.read_id, session.id);
  const sStart = new Date(session.started_at).getTime();
  const sEnd = new Date(session.ended_at).getTime();
  if (Number.isNaN(sStart) || Number.isNaN(sEnd) || sEnd <= sStart) return { adjusted_seconds: 0, adjustments: [] };
  let adjusted = 0;
  const adjustments = [];
  for (const row of inferred) {
    const iStart = new Date(row.started_at).getTime();
    const iEnd = new Date(row.ended_at).getTime();
    if (Number.isNaN(iStart) || Number.isNaN(iEnd) || iEnd <= iStart) continue;
    const overlapStart = Math.max(sStart, iStart);
    const overlapEnd = Math.min(sEnd, iEnd);
    const overlapSeconds = Math.round((overlapEnd - overlapStart) / 1000);
    if (overlapSeconds <= 0) continue;
    const adj = await insertAdjustment(db, row, overlapSeconds, session.local_date,
      new Date(overlapStart).toISOString(), new Date(overlapEnd).toISOString());
    if (adj) { adjusted += adj.seconds; adjustments.push(adj); }
  }
  return { adjusted_seconds: adjusted, adjustments };
}

// m7: void inferred estimates created by the immediately preceding save
// (created_at >= sinceIso) when an audiobook advance is corrected downward.
async function voidInferredSince(db, readId, sinceIso, localDate = null) {
  const rows = localDate
    ? await all(db, `SELECT * FROM reading_sessions WHERE read_id=? AND source='inferred' AND local_date=? AND created_at>=? AND ended_at IS NOT NULL`, readId, localDate, sinceIso)
    : await all(db, `SELECT * FROM reading_sessions WHERE read_id=? AND source='inferred' AND created_at>=? AND ended_at IS NOT NULL`, readId, sinceIso);
  let adjusted = 0;
  const adjustments = [];
  for (const row of rows) {
    const adj = await insertAdjustment(db, row, Number(row.duration_seconds || 0), row.local_date);
    if (adj) { adjusted += adj.seconds; adjustments.push(adj); }
  }
  return { adjusted_seconds: adjusted, adjustments };
}

// Merge overlapping/adjacent date ranges so duplicate same-state periods
// (pre-v0.0.27 double-inserts Julie hasn't decided to remove) can't
// double-count days. Pure read-path computation; data untouched.
function mergeDateRanges(ranges) {
  const sorted = ranges.filter(([s, e]) => s && e && e >= s)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const merged = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= addCalendarDays(last[1], 1)) last[1] = e > last[1] ? e : last[1];
    else merged.push([s, e]);
  }
  return merged;
}

async function handleApi(request, env, url) {
  auth(request, env);
  const db = env.DB;
  const path = url.pathname;
  const method = request.method;
  await ensureSchema(db);

  if (path === "/api/bootstrap" && method === "GET") return json(await bootstrap(db, url));
  if (path === "/api/checkins/pending" && method === "GET") return json(await pendingCheckins(db, url.searchParams.get("date") || localDateKey()));
  if (path === "/api/widget/currently-reading" && method === "GET") return json(await widgetCurrentlyReading(db, url));

  if (path === "/api/books/search" && method === "GET") {
    const query=String(url.searchParams.get("q")||"").trim();
    if(query.length<2)return json([]);

    const compact=query.replace(/[-\s]/g,"");
    const looksIsbn=/^(?:\d{10}|\d{13})$/.test(compact);
    const looksAsin=/^[A-Z0-9]{10}$/i.test(compact)&&!looksIsbn;
    const asin=looksAsin?compact.toUpperCase():"";
    const results=[];
    const norm=(value)=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const queryWords=norm(query).split(" ").filter(w=>w.length>1);
    const cleanDescription=(value)=>String(value||"").replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
    const langName=(value)=>({en:"English",eng:"English"}[String(value||"").toLowerCase()]||String(value||""));
    const pushResult=(book)=>{
      if(!book?.title)return;
      book.description=cleanDescription(book.description);
      book.language=langName(book.language);
      results.push(book);
    };

    // Exact ISBN first. Open Library explicitly models ISBN records as editions,
    // so edition facts here outrank work-level/title-search metadata.
    if(looksIsbn){
      try{
        const response=await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(compact)}&jscmd=data&format=json`,{
          headers:{"user-agent":"OpalShelf/0.0.36 (personal reading tracker)"}
        });
        if(response.ok){
          const data=await response.json(), b=data[`ISBN:${compact}`];
          if(b)pushResult({
            source:"Open Library", match_label:"Exact ISBN edition", match_confidence:"exact",
            source_id:b.key||`ISBN:${compact}`, title:b.title||"", subtitle:b.subtitle||"",
            authors:(b.authors||[]).map(a=>a.name).filter(Boolean),
            cover_url:b.cover?.large||b.cover?.medium||b.cover?.small||"", isbn:compact, asin:"",
            publisher:b.publishers?.[0]?.name||"", publication_date:b.publish_date||"",
            page_count:b.number_of_pages||"", language:"",
            genres:(b.subjects||[]).slice(0,8).map(s=>s.name).filter(Boolean),
            exact_identifier_match:true
          });
        }
      }catch(_){}
    }

    // Open Library Search supplies both work-level discovery and edition docs.
    try{
      const olQuery=looksIsbn?`isbn:${compact}`:query;
      const fields="key,title,subtitle,author_name,cover_i,isbn,first_publish_year,publisher,language,number_of_pages_median,subject,editions";
      const response=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(olQuery)}&limit=20&fields=${encodeURIComponent(fields)}`,{
        headers:{"user-agent":"OpalShelf/0.0.36 (personal reading tracker)"}
      });
      if(response.ok){
        const data=await response.json();
        for(const b of (data.docs||[])){
          const editionDocs=b.editions?.docs||[];
          let matchingEdition=null;
          if(asin){
            matchingEdition=editionDocs.find(ed=>{
              const ids=ed.identifiers||{};
              return [...(ids.amazon||[]),...(ids.amazon_asin||[]),...(ids.asin||[])].map(String).some(id=>id.toUpperCase()===asin);
            })||null;
          }else if(looksIsbn){
            matchingEdition=editionDocs.find(ed=>(ed.isbn_10||[]).includes(compact)||(ed.isbn_13||[]).includes(compact))||null;
          }
          const edition=matchingEdition||editionDocs[0]||null;
          const editionIsbns=[...(edition?.isbn_13||[]),...(edition?.isbn_10||[]),...(b.isbn||[])];
          const exact=Boolean(matchingEdition);
          pushResult({
            source:"Open Library", match_label:exact?(asin?"Exact ASIN-linked edition":"Exact ISBN edition"):"Catalog edition",
            match_confidence:exact?"exact":"candidate", source_id:edition?.key||b.key,
            title:edition?.title||b.title, subtitle:edition?.subtitle||b.subtitle||"", authors:b.author_name||[],
            cover_url:(edition?.covers?.[0]||b.cover_i)?`https://covers.openlibrary.org/b/id/${edition?.covers?.[0]||b.cover_i}-L.jpg`:"",
            isbn:looksIsbn?compact:(editionIsbns[0]||""), asin:asin||"",
            publisher:edition?.publishers?.[0]||b.publisher?.[0]||"",
            publication_date:edition?.publish_date||(b.first_publish_year?String(b.first_publish_year):""),
            page_count:edition?.number_of_pages||b.number_of_pages_median||"",
            language:edition?.languages?.[0]?.key?.split("/").pop()||b.language?.[0]||"",
            genres:(b.subject||[]).slice(0,8), exact_identifier_match:exact
          });
        }
      }
    }catch(_){}

    // Google Books is a second free catalog. Its public Volume resource can
    // contribute description/categories and exact-ISBN edition facts.
    try{
      const googleQuery=looksIsbn?`isbn:${compact}`:query;
      const response=await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(googleQuery)}&maxResults=20&printType=books&projection=full`);
      if(response.ok){
        const data=await response.json();
        for(const item of (data.items||[])){
          const v=item.volumeInfo||{}, ids=v.industryIdentifiers||[];
          const isbn13=ids.find(x=>x.type==="ISBN_13")?.identifier||"", isbn10=ids.find(x=>x.type==="ISBN_10")?.identifier||"";
          const exact=looksIsbn&&(isbn13===compact||isbn10===compact);
          pushResult({
            source:"Google Books", match_label:exact?"Exact ISBN edition":"Catalog edition", match_confidence:exact?"exact":"candidate",
            source_id:item.id, title:v.title||"", subtitle:v.subtitle||"", authors:v.authors||[],
            cover_url:(v.imageLinks?.extraLarge||v.imageLinks?.large||v.imageLinks?.medium||v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||"").replace(/^http:/,"https:"),
            isbn:isbn13||isbn10||"", asin:asin||"", publisher:v.publisher||"", publication_date:v.publishedDate||"",
            page_count:v.pageCount||"", language:v.language||"", genres:(v.categories||[]).slice(0,8),
            description:v.description||"", exact_identifier_match:exact
          });
        }
      }
    }catch(_){}

    // Merge records only when they clearly describe the same edition. Exact
    // edition facts stay authoritative; other catalogs only fill blanks.
    const editionKey=(b)=>{
      if(b.isbn)return `isbn:${String(b.isbn).replace(/[-\s]/g,"")}`;
      if(b.asin)return `asin:${String(b.asin).toUpperCase()}`;
      return `text:${norm(b.title)}::${norm((b.authors||[])[0])}::${norm(b.publisher)}::${String(b.publication_date||"").slice(0,4)}`;
    };
    const merged=new Map();
    for(const candidate of results){
      const key=editionKey(candidate), existing=merged.get(key);
      if(!existing){ merged.set(key,{...candidate}); continue; }
      const primary=existing.match_confidence==="exact"?existing:(candidate.match_confidence==="exact"?candidate:existing);
      const secondary=primary===existing?candidate:existing;
      const out={...primary};
      for(const field of ["subtitle","cover_url","publisher","publication_date","page_count","language","description","isbn","asin"]){
        if(!out[field]&&secondary[field])out[field]=secondary[field];
      }
      if(!(out.authors||[]).length&&(secondary.authors||[]).length)out.authors=secondary.authors;
      if(!(out.genres||[]).length&&(secondary.genres||[]).length)out.genres=secondary.genres;
      out.sources=[...new Set([...(existing.sources||[existing.source]),...(candidate.sources||[candidate.source])].filter(Boolean))];
      merged.set(key,out);
    }

    const richness=(b)=>(b.cover_url?2:0)+(b.description?2:0)+(b.page_count?1:0)+(b.publisher?1:0)+(b.publication_date?1:0)+(b.isbn?2:0);
    const relevance=(b)=>{
      const hay=norm([b.title,...(b.authors||[])].join(" "));
      return queryWords.reduce((score,word)=>score+(hay.includes(word)?2:0),0);
    };
    const unique=[...merged.values()].sort((a,b)=>
      Number(b.match_confidence==="exact")-Number(a.match_confidence==="exact")||
      relevance(b)-relevance(a)||richness(b)-richness(a)
    );
    return json(unique.slice(0,20));
  }

  if (path === "/api/books" && method === "POST") {
    const input = cleanBook(await parseJson(request));
    const bookId = id("book");
    const timestamp = now();
    await db.prepare(`INSERT INTO books (
      id,title,subtitle,authors_json,cover_url,series_name,series_number,description,genres_json,format_metadata,isbn,asin,publisher,publication_date,page_count,audiobook_runtime_seconds,narrators_json,language,personal_tags_json,favorite,status,book_dnf,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      bookId,input.title,input.subtitle,input.authors_json,input.cover_url,input.series_name,input.series_number,input.description,input.genres_json,input.format_metadata,input.isbn,input.asin,input.publisher,input.publication_date,input.page_count,input.audiobook_runtime_seconds,input.narrators_json,input.language,input.personal_tags_json,input.favorite,input.status,input.book_dnf,timestamp,timestamp
    ).run();
    return json(decodeBook(await first(db, "SELECT * FROM books WHERE id = ?", bookId)), 201);
  }

  const widgetFeaturedMatch = path.match(/^\/api\/books\/([^/]+)\/widget-featured$/);
  if (widgetFeaturedMatch && method === "POST") {
    const bookId = widgetFeaturedMatch[1];
    const body = await parseJson(request);
    const featured = body.featured ? 1 : 0;
    const timestamp = now();
    const book = await first(db, "SELECT id FROM books WHERE id=?", bookId);
    if (!book) throw new HttpError(404, "Book not found");
    if (featured) {
      await db.batch([
        db.prepare("UPDATE books SET widget_featured=0 WHERE widget_featured<>0"),
        db.prepare("UPDATE books SET widget_featured=1, updated_at=? WHERE id=?").bind(timestamp, bookId)
      ]);
    } else {
      await db.prepare("UPDATE books SET widget_featured=0, updated_at=? WHERE id=?").bind(timestamp, bookId).run();
    }
    return json({ id: bookId, widget_featured: Boolean(featured) });
  }
  const coverUploadMatch = path.match(/^\/api\/books\/([^/]+)\/cover$/);
  if (coverUploadMatch && method === "PUT") {
    const bookId=coverUploadMatch[1];
    const book=await first(db,"SELECT id FROM books WHERE id=?",bookId);
    if(!book)throw new HttpError(404,"Book not found");
    const contentType=String(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
    if(!["image/jpeg","image/png","image/webp"].includes(contentType))throw new HttpError(415,"Cover must be a JPEG, PNG, or WebP image");
    const bytes=await request.arrayBuffer();
    if(!bytes.byteLength)throw new HttpError(400,"Cover image is empty");
    if(bytes.byteLength>5*1024*1024)throw new HttpError(413,"Cover image must be 5 MB or smaller");
    // D1 BLOB parameters and query results use byte arrays. Binding an
    // ArrayBuffer can produce a value that does not round-trip as image bytes.
    const blobBytes=[...new Uint8Array(bytes)];
    const timestamp=now();
    await db.prepare(`INSERT INTO book_cover_assets (book_id,content_type,data,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET content_type=excluded.content_type,data=excluded.data,updated_at=excluded.updated_at`)
      .bind(bookId,contentType,blobBytes,timestamp).run();
    const coverUrl=`${url.origin}/covers/${encodeURIComponent(bookId)}?v=${Date.now()}`;
    await db.prepare("UPDATE books SET cover_url=?,updated_at=? WHERE id=?").bind(coverUrl,timestamp,bookId).run();
    return json({ok:true,cover_url:coverUrl});
  }

  const bookMatch = path.match(/^\/api\/books\/([^/]+)$/);
  if (bookMatch && method === "PUT") {
    const raw = await parseJson(request);
    const bookId = bookMatch[1];
    const existingBook = await first(db, "SELECT cover_url FROM books WHERE id=?", bookId);
    if (!existingBook) throw new HttpError(404, "Book not found");
    if (raw.remove_cover) {
      raw.cover_url = "";
      await db.prepare("DELETE FROM book_cover_assets WHERE book_id=?").bind(bookId).run();
    } else if (!String(raw.cover_url || "").trim() && existingBook.cover_url) {
      raw.cover_url = existingBook.cover_url;
    } else if (String(raw.cover_url||"").trim() && String(raw.cover_url||"").trim() !== String(existingBook.cover_url||"").trim()) {
      await db.prepare("DELETE FROM book_cover_assets WHERE book_id=?").bind(bookId).run();
    }
    const input = cleanBook(raw);
    const result = await db.prepare(`UPDATE books SET title=?,subtitle=?,authors_json=?,cover_url=?,series_name=?,series_number=?,description=?,genres_json=?,format_metadata=?,isbn=?,asin=?,publisher=?,publication_date=?,page_count=?,audiobook_runtime_seconds=?,narrators_json=?,language=?,personal_tags_json=?,favorite=?,status=?,book_dnf=?,updated_at=? WHERE id=?`).bind(
      input.title,input.subtitle,input.authors_json,input.cover_url,input.series_name,input.series_number,input.description,input.genres_json,input.format_metadata,input.isbn,input.asin,input.publisher,input.publication_date,input.page_count,input.audiobook_runtime_seconds,input.narrators_json,input.language,input.personal_tags_json,input.favorite,input.status,input.book_dnf,now(),bookId
    ).run();
    if (!result.meta.changes) throw new HttpError(404, "Book not found");
    return json(decodeBook(await first(db, "SELECT * FROM books WHERE id = ?", bookId)));
  }
  if (bookMatch && method === "DELETE") {
    const bookId=bookMatch[1];
    const book=await first(db,"SELECT id FROM books WHERE id=?",bookId);
    if(!book)throw new HttpError(404,"Book not found");
    const reads=await all(db,"SELECT id FROM read_throughs WHERE book_id=?",bookId);
    const statements=[
      db.prepare("DELETE FROM book_cover_assets WHERE book_id=?").bind(bookId),
      db.prepare("DELETE FROM shelf_books WHERE book_id=?").bind(bookId),
      db.prepare("DELETE FROM reading_sessions WHERE book_id=?").bind(bookId)
    ];
    for(const read of reads){
      statements.push(db.prepare("DELETE FROM daily_checkins WHERE read_id=?").bind(read.id));
      statements.push(db.prepare("DELETE FROM read_state_periods WHERE read_id=?").bind(read.id));
    }
    statements.push(db.prepare("DELETE FROM read_throughs WHERE book_id=?").bind(bookId));
    statements.push(db.prepare("DELETE FROM books WHERE id=?").bind(bookId));
    await db.batch(statements);
    return json({ok:true,deleted_book_id:bookId});
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
    const startDay = input.start_date || input.local_date;
    if (!startDay) throw new HttpError(400, "Start date is required");
    const format = ["print", "ebook", "audiobook", "other"].includes(input.format) ? input.format : "print";
    const pageSnapshot = format === "print" || format === "ebook" || format === "other" ? book.page_count : null;
    const audioSnapshot = format === "audiobook" ? book.audiobook_runtime_seconds : null;
    await db.batch([
      db.prepare(`INSERT INTO read_throughs (id,book_id,read_number,start_date,state,format,starting_page,starting_percent,progress_page,progress_percent,listening_speed,notes,page_count_snapshot,audiobook_runtime_seconds_snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        readId,input.book_id,Number(sequence.max_number)+1,startDay,"active",format,input.starting_page ?? null,input.starting_percent ?? null,input.starting_page ?? null,input.starting_percent ?? null,Number(input.listening_speed || 1),String(input.notes || "").trim() || null,pageSnapshot,audioSnapshot,timestamp,timestamp
      ),
      db.prepare("UPDATE books SET status='reading',book_dnf=0,updated_at=? WHERE id=?").bind(timestamp,input.book_id)
    ]);
    // recordReadStateChange is idempotent: the backfill inside it creates the
    // single opening "active" period, and the explicit same-state insert that
    // used to follow it double-counted active days. Do not add another insert.
    await recordReadStateChange(db, { id: readId }, "active", startDay);
    return json(await first(db, "SELECT * FROM read_throughs WHERE id=?", readId), 201);
  }

  const readMatch = path.match(/^\/api\/reads\/([^/]+)$/);
  if (readMatch && method === "PUT") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", readMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    const state = ["active","paused","finished","dnf"].includes(input.state) ? input.state : read.state;
    const format = ["print","ebook","audiobook","other"].includes(input.format) ? input.format : read.format;
    const startDate = String(input.start_date || "").trim();
    if (!startDate) throw new HttpError(400, "Start date is required");
    if (state === "active") {
      const conflict = await first(db, "SELECT id FROM read_throughs WHERE book_id=? AND state='active' AND id<>?", read.book_id, read.id);
      if (conflict) throw new HttpError(409, "This book already has another active read-through");
    }
    const finishDate = (state === "active" || state === "paused") ? null : String(input.finish_date || read.finish_date || "").trim() || null;
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
    if (state !== read.state) await recordReadStateChange(db, read, state, String(input.state_change_date || input.local_date || localDateKey()));
    await syncBookStatus(db, read.book_id, timestamp);
    return json(await first(db, "SELECT * FROM read_throughs WHERE id=?", read.id));
  }

  if (readMatch && method === "DELETE") {
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", readMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");
    await db.batch([
      db.prepare("DELETE FROM reading_sessions WHERE read_id=?").bind(read.id),
      db.prepare("DELETE FROM daily_checkins WHERE read_id=?").bind(read.id),
      db.prepare("DELETE FROM read_state_periods WHERE read_id=?").bind(read.id),
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
    let percent = input.percent === "" || input.percent == null ? read.progress_percent : Math.min(100, Math.max(0, Number(input.percent)));
    if (read.format === "audiobook" && input.content_position) {
      const positionMatch = String(input.content_position).trim().match(/^(\d+):([0-5]\d)$/);
      if (!positionMatch) throw new HttpError(400, "Content position must be h:mm");
      const contentSeconds = (Number(positionMatch[1]) * 60 + Number(positionMatch[2])) * 60;
      const bookForRuntime = await first(db, "SELECT audiobook_runtime_seconds FROM books WHERE id=?", read.book_id);
      const exactRuntime = Number(read.audiobook_runtime_seconds_snapshot || bookForRuntime?.audiobook_runtime_seconds || 0);
      if (!exactRuntime || contentSeconds > exactRuntime) throw new HttpError(400, "Content position is beyond the audiobook length");
      percent = contentSeconds / exactRuntime * 100;
    }
    const speed = Math.max(0.05, Number(input.listening_speed || read.listening_speed || 1));
    const timestamp = now();
    let inferredSeconds = 0;
    let timerCovered = false;
    let coveredSeconds = 0;
    let voidedSeconds = 0;
    const oldPercent = Number(read.progress_percent ?? read.starting_percent ?? 0);
    const deltaPercent = percent - oldPercent;
    if (read.format === "audiobook" && deltaPercent > 0) {
      const book = await first(db, "SELECT audiobook_runtime_seconds FROM books WHERE id=?", read.book_id);
      const runtime = Number(read.audiobook_runtime_seconds_snapshot || book?.audiobook_runtime_seconds || 0);
      if (runtime > 0) {
        // Keep all audiobook math in seconds end-to-end.
        // Do not round audiobook positions or intermediate content duration to whole minutes.
        const contentDeltaSeconds = runtime * (deltaPercent / 100);
        const expectedSeconds = Math.max(1, Math.round(contentDeltaSeconds / speed));
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
    } else if (read.format === "audiobook" && deltaPercent < 0) {
      // m7: downward correction — void inferred estimates created by the
      // immediately preceding (over-reported) save. Existing rows untouched.
      const voided = await voidInferredSince(db, read.id, read.updated_at || read.created_at || timestamp);
      voidedSeconds = voided.adjusted_seconds;
    }
    const updates = [db.prepare("UPDATE read_throughs SET progress_page=?, progress_percent=?, listening_speed=?, updated_at=? WHERE id=?").bind(page,percent,speed,timestamp,read.id)];
    if (inferredSeconds) {
      const endedAt = timestamp;
      const startedAt = new Date(new Date(endedAt).getTime() - inferredSeconds * 1000).toISOString();
      updates.push(db.prepare("INSERT INTO reading_sessions (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,listening_speed,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(
        id("session"),read.id,read.book_id,input.local_date || endedAt.slice(0,10),startedAt,endedAt,inferredSeconds,speed,"inferred",timestamp
      ));
    }
    await db.batch(updates);
    const updated = await first(db, "SELECT * FROM read_throughs WHERE id=?", read.id);
    return json({ ...updated, inferred_duration_seconds:inferredSeconds, timer_covered:timerCovered, timer_covered_seconds:coveredSeconds || 0,
      ...(voidedSeconds ? { voided_inferred_seconds:voidedSeconds } : {}) });
  }

  const finishMatch = path.match(/^\/api\/reads\/([^/]+)\/(finish|dnf)$/);
  if (finishMatch && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", finishMatch[1]);
    if (!read) throw new HttpError(404, "Read-through not found");

    const state = finishMatch[2] === "finish" ? "finished" : "dnf";
    const timestamp = now();
    let inferredSeconds = 0;
    let coveredSeconds = 0;

    // For audiobooks, Finish Read is also the final progress update.
    // Save the remaining listening interval BEFORE closing the read-through.
    if (state === "finished" && read.format === "audiobook") {
      const currentPercent = Number(read.progress_percent ?? read.starting_percent ?? 0);

      if (currentPercent < 100) {
        const book = await first(db, "SELECT audiobook_runtime_seconds FROM books WHERE id=?", read.book_id);
        const runtime = Number(read.audiobook_runtime_seconds_snapshot || book?.audiobook_runtime_seconds || 0);
        const speed = Math.max(0.05, Number(input.listening_speed || read.listening_speed || 1));

        if (runtime > 0) {
          const contentDeltaSeconds = runtime * ((100 - currentPercent) / 100);
          const expectedSeconds = Math.max(1, Math.round(contentDeltaSeconds / speed));

          // Preserve the existing double-count protection: timer activity since the
          // last progress save covers part of this final interval.
          const coverageStart = new Date(read.updated_at || read.created_at || timestamp);
          const coverageEnd = new Date(timestamp);
          const relevantSessions = await all(db, `SELECT started_at, ended_at, duration_seconds
            FROM reading_sessions
            WHERE read_id=? AND (ended_at IS NULL OR ended_at>?)
            ORDER BY started_at`, read.id, coverageStart.toISOString());

          for (const session of relevantSessions) {
            const sessionStart = new Date(session.started_at);
            const sessionEnd = session.ended_at ? new Date(session.ended_at) : coverageEnd;
            const overlapStart = sessionStart > coverageStart ? sessionStart : coverageStart;
            const overlapEnd = sessionEnd < coverageEnd ? sessionEnd : coverageEnd;
            if (overlapEnd > overlapStart) {
              coveredSeconds += Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 1000));
            }
          }

          inferredSeconds = Math.max(0, expectedSeconds - coveredSeconds);

          if (inferredSeconds > 0) {
            const endedAt = timestamp;
            const startedAt = new Date(new Date(endedAt).getTime() - inferredSeconds * 1000).toISOString();
            await db.prepare(`INSERT INTO reading_sessions
              (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,listening_speed,source,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
              .bind(
                id("session"), read.id, read.book_id,
                input.local_date || endedAt.slice(0,10),
                startedAt, endedAt, inferredSeconds, speed, "inferred", timestamp
              ).run();
          }
        }
      }
    }

    await db.prepare(
      "UPDATE read_throughs SET state=?,finish_date=?,final_page=COALESCE(?,progress_page),final_percent=COALESCE(?,progress_percent),progress_percent=CASE WHEN ?='finished' THEN 100 ELSE progress_percent END,updated_at=? WHERE id=?"
    ).bind(
      state,
      input.finish_date || input.local_date,
      input.page ?? null,
      state === "finished" ? 100 : (input.percent ?? null),
      state,
      timestamp,
      read.id
    ).run();

    await recordReadStateChange(db, read, state, String(input.finish_date || input.local_date || localDateKey()));
    await syncBookStatus(db, read.book_id, timestamp);

    return json({
      ok: true,
      inferred_duration_seconds: inferredSeconds,
      timer_covered_seconds: coveredSeconds
    });
  }

  if (path === "/api/sessions/start" && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=? AND state='active'", input.read_id);
    if (!read) throw new HttpError(404, "Active read-through not found");
    // m4: validate started_at; default local_date instead of 500ing on NOT NULL.
    const startDate = new Date(String(input.started_at || now()));
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, "Invalid session start time");
    // M2: canonical UTC for storage.
    const startedAt = startDate.toISOString();
    const localDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.local_date || "")) ? String(input.local_date) : localDateKey(startDate);
    const existing = await first(db, "SELECT * FROM reading_sessions WHERE ended_at IS NULL");
    if (existing) {
      // M4: a crashed timer stays open forever and blocks all new timers.
      // Existing rows are never auto-modified: a stale (>24h) timer is refused
      // with a message naming its age; Julie stops it herself (stop caps the
      // duration at 24h). A fresh timer keeps the original 409.
      const ageMs = Date.now() - new Date(existing.started_at).getTime();
      if (!Number.isFinite(ageMs) || ageMs < 0) throw new HttpError(409, "A timer with an unreadable start time is still open. Stop it manually before starting a new one.");
      const ageHours = ageMs / 3600000;
      if (ageHours > 24) throw new HttpError(409, `A stale timer is still open (started ${Math.floor(ageHours)}h ago). Stop it before starting a new one — stopping caps its duration at 24h.`);
      throw new HttpError(409, "Another reading timer is already running");
    }
    const sessionId = id("session");
    await db.prepare("INSERT INTO reading_sessions (id,read_id,book_id,local_date,started_at,listening_speed,source,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(sessionId,read.id,read.book_id,localDate,startedAt,read.format === "audiobook" ? Number(read.listening_speed || 1) : null,"timer",now()).run();
    return json(await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionId), 201);
  }

  if (path === "/api/sessions" && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", input.read_id);
    // m9: name the recovery step — a deleted read-through otherwise makes the
    // Reader flush retry 30x then silently drop the minutes.
    if (!read) throw new HttpError(404, "Read-through not found. If this came from the Opal Reader sync, re-link the book in Opal Shelf and try again.");
    // m3: sessions belong to active read-throughs only.
    if (read.state !== "active") throw new HttpError(409, "This read-through is not active; sessions can only be logged while reading");

    // M1: idempotent ingest. The Reader sends a stable client_session_id per
    // outbox item; a retried POST (response lost after a successful insert)
    // returns the existing row instead of double-inserting. Pre-idempotency
    // clients can't send the key — see READER-SYNC-CONTRACT.md.
    const clientSessionId = String(input.client_session_id || "").trim() || null;
    if (clientSessionId) {
      const replay = await first(db, "SELECT * FROM reading_sessions WHERE client_session_id=?", clientSessionId);
      if (replay) return json({ ...replay, idempotent_replay: true });
    }

    const localDate = String(input.local_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new HttpError(400, "Session date must be YYYY-MM-DD");

    // M2: normalize to UTC for storage. The client sends its device wall-clock
    // with its UTC offset; the instant is identical, and every SQL TEXT
    // comparison / sort on timestamps needs a single canonical form.
    const startedAtInput = String(input.started_at || "");
    const startDate = new Date(startedAtInput);
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, "Invalid session start time");
    const startedAt = startDate.toISOString();

    let endedAt = input.ended_at ? String(input.ended_at) : null;
    let duration = null;

    if (input.duration_seconds != null && input.duration_seconds !== "") {
      duration = Math.max(0, Math.round(Number(input.duration_seconds)));
      if (!Number.isFinite(duration)) throw new HttpError(400, "Invalid session duration");
      endedAt = new Date(startDate.getTime() + duration * 1000).toISOString();
    } else {
      const endDate = new Date(endedAt);
      if (!endedAt || Number.isNaN(endDate.getTime()) || endDate < startDate) throw new HttpError(400, "Session end must be after session start");
      endedAt = endDate.toISOString();
      duration = durationSeconds(startDate, endDate);
    }

    // m3: an exact-duplicate retry without an idempotency key replays the
    // existing row instead of 409ing (best effort for pre-key clients).
    if (!clientSessionId) {
      const exactDupe = await first(db, `SELECT * FROM reading_sessions WHERE read_id=? AND started_at=? AND duration_seconds=? AND ended_at IS NOT NULL LIMIT 1`,
        read.id, startedAt, duration);
      if (exactDupe) return json({ ...exactDupe, idempotent_replay: true, replay_match: "exact" });
    }

    // m3: refuse genuinely overlapping intervals (a retry carrying merged/
    // extended data, or a mistyped manual entry). Inferred estimates and
    // their corrections are excluded — those reconcile, below.
    const overlap = await first(db, `SELECT id, started_at, ended_at FROM reading_sessions
      WHERE read_id=? AND ended_at IS NOT NULL AND started_at < ? AND ended_at > ?
      AND (source IS NULL OR source NOT IN ('inferred','adjustment')) LIMIT 1`,
      read.id, endedAt, startedAt);
    if (overlap) throw new HttpError(409, `This session overlaps an existing session (${overlap.started_at} – ${overlap.ended_at})`);

    // m3: local_date should be the device date of started_at (±1 day for
    // timezone edges); beyond that the minutes land on the wrong day.
    // The check runs on the client's original offset-bearing string.
    const startDay = dateKeyInOffset(startedAtInput);
    let localDateWarning = null;
    if (startDay) {
      const dayDiff = Math.round((new Date(`${localDate}T00:00:00Z`).getTime() - new Date(`${startDay}T00:00:00Z`).getTime()) / 86400000);
      if (Math.abs(dayDiff) > 1) throw new HttpError(400, `Session date ${localDate} does not match the session start (${startDay})`);
      if (dayDiff !== 0) localDateWarning = `Session date ${localDate} differs from the start-time date ${startDay}`;
    }

    let listeningSpeed = null;
    if (read.format === "audiobook") {
      listeningSpeed = Number(input.listening_speed || read.listening_speed || 1);
      if (!Number.isFinite(listeningSpeed) || listeningSpeed <= 0) throw new HttpError(400, "Listening speed must be greater than zero");
    }

    const sessionId = id("session");
    const timestamp = now();
    await db.prepare(`INSERT INTO reading_sessions
      (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,listening_speed,client_session_id,source,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
      .bind(sessionId,read.id,read.book_id,localDate,startedAt,endedAt,duration,listeningSpeed,clientSessionId,clientSessionId ? "reader" : "manual",timestamp).run();

    // A racing retry with the same key inserts nothing; either way the row
    // addressed by the key is the response, so the outbox can drop the item.
    const row = clientSessionId
      ? await first(db, "SELECT * FROM reading_sessions WHERE client_session_id=?", clientSessionId)
      : await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionId);
    if (!row) throw new HttpError(500, "Session was not recorded");
    const inserted = row.id === sessionId;

    // M5: void any inferred estimate this late arrival overlaps.
    const reconciliation = inserted ? await voidInferredOverlap(db, row) : { adjusted_seconds: 0 };

    return json({
      ...row,
      ...(inserted ? {} : { idempotent_replay: true }),
      ...(localDateWarning ? { local_date_warning: localDateWarning } : {}),
      ...(reconciliation.adjusted_seconds ? { overlap_adjusted_seconds: reconciliation.adjusted_seconds } : {})
    }, inserted ? 201 : 200);
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

    const startedAtInput = input.started_at == null ? null : String(input.started_at);
    const endedAtInput = input.ended_at == null ? null : String(input.ended_at);
    const startDate = new Date(startedAtInput == null ? session.started_at : startedAtInput);
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, "Invalid session start time");
    // M2: normalize to UTC for storage (see POST /api/sessions).
    const startedAt = startDate.toISOString();

    let duration = Number(session.duration_seconds || 0);
    let endedAt;
    if (input.duration_seconds != null && input.duration_seconds !== "") {
      duration = Math.max(0, Math.round(Number(input.duration_seconds)));
      if (!Number.isFinite(duration)) throw new HttpError(400, "Invalid session duration");
      endedAt = new Date(startDate.getTime() + duration * 1000).toISOString();
    } else {
      const endDate = new Date(endedAtInput == null ? session.ended_at : endedAtInput);
      if (Number.isNaN(endDate.getTime()) || endDate < startDate) throw new HttpError(400, "Session end must be after session start");
      endedAt = endDate.toISOString();
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

    // m3: an edit must not create an overlap either (inferred estimates and
    // corrections excluded — those reconcile below).
    const overlap = await first(db, `SELECT id, started_at, ended_at FROM reading_sessions
      WHERE read_id=? AND id<>? AND ended_at IS NOT NULL AND started_at < ? AND ended_at > ?
      AND (source IS NULL OR source NOT IN ('inferred','adjustment')) LIMIT 1`,
      readId, session.id, endedAt, startedAt);
    if (overlap) throw new HttpError(409, `This session would overlap an existing session (${overlap.started_at} – ${overlap.ended_at})`);

    await db.prepare(`UPDATE reading_sessions SET
      read_id=?,book_id=?,local_date=?,started_at=?,ended_at=?,duration_seconds=?,listening_speed=?
      WHERE id=?`).bind(readId,bookId,localDate,startedAt,endedAt,duration,listeningSpeed,session.id).run();
    const updatedSession = await first(db, "SELECT * FROM reading_sessions WHERE id=?", session.id);
    // M5: an edited interval may now cover an inferred estimate.
    const reconciliation = await voidInferredOverlap(db, updatedSession);
    return json({ ...updatedSession,
      ...(reconciliation.adjusted_seconds ? { overlap_adjusted_seconds: reconciliation.adjusted_seconds } : {}) });
  }

  if (sessionMatch && method === "DELETE") {
    const session = await first(db, "SELECT * FROM reading_sessions WHERE id=?", sessionMatch[1]);
    if (!session) throw new HttpError(404, "Session not found");
    if (!session.ended_at) throw new HttpError(409, "Stop this timer before deleting the session");
    await db.batch([
      // Corrections belong to their inferred estimate; deleting the estimate
      // deletes its corrections so no orphaned negative minutes remain.
      db.prepare("DELETE FROM reading_sessions WHERE adjusts_session_id=? AND source='adjustment'").bind(session.id),
      db.prepare("DELETE FROM reading_sessions WHERE id=?").bind(session.id)
    ]);
    return json({ ok:true, deleted_session_id:session.id });
  }

  const stopMatch = path.match(/^\/api\/sessions\/([^/]+)\/stop$/);
  if (stopMatch && method === "POST") {
    const input = await parseJson(request);
    const session = await first(db, "SELECT * FROM reading_sessions WHERE id=?", stopMatch[1]);
    if (!session) throw new HttpError(404, "Session not found");
    if (session.ended_at) return json(session);
    const endDate = new Date(String(input.ended_at || now()));
    if (Number.isNaN(endDate.getTime())) throw new HttpError(400, "Invalid session end time");
    // M2: canonical UTC for storage.
    const endedAt = endDate.toISOString();
    const startDate = new Date(session.started_at);
    if (Number.isNaN(startDate.getTime())) throw new HttpError(400, "This timer has an unreadable start time and cannot be stopped automatically");
    // M4: end-before-start is a 400, not a silent 0.
    if (endDate < startDate) throw new HttpError(400, "Session end must be after session start");
    // M4: a crashed timer accrues unbounded duration — cap at 24h with a flag.
    const MAX_TIMER_SECONDS = 24 * 3600;
    const rawDuration = durationSeconds(startDate, endDate);
    const capped = rawDuration > MAX_TIMER_SECONDS;
    const duration = capped ? MAX_TIMER_SECONDS : rawDuration;
    await db.prepare("UPDATE reading_sessions SET ended_at=?,duration_seconds=? WHERE id=?").bind(endedAt,duration,session.id).run();
    const row = await first(db, "SELECT * FROM reading_sessions WHERE id=?", session.id);
    const reconciliation = await voidInferredOverlap(db, row);
    return json({ ...row,
      ...(capped ? { duration_capped: true, uncapped_duration_seconds: rawDuration } : {}),
      ...(reconciliation.adjusted_seconds ? { overlap_adjusted_seconds: reconciliation.adjusted_seconds } : {}) });
  }

  if (path === "/api/checkins" && method === "POST") {
    const input = await parseJson(request);
    const read = await first(db, "SELECT * FROM read_throughs WHERE id=?", input.read_id);
    if (!read) throw new HttpError(404, "Read-through not found");

    const sessionDate = String(input.session_date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) throw new HttpError(400, "A valid session date is required");

    // A rollover reconciliation belongs to the day whose sessions are being reconciled.
    // Derive that day's starting point from the most recent earlier daily check-in,
    // falling back to the read-through's original starting progress.
    const prior = await first(db, `SELECT new_page,new_percent,reconciled_at
      FROM daily_checkins
      WHERE read_id=? AND session_date<?
      ORDER BY session_date DESC, reconciled_at DESC
      LIMIT 1`, read.id, sessionDate);

    const previousPage = prior?.new_page ?? read.starting_page ?? null;
    const previousPercent = prior?.new_percent ?? read.starting_percent ?? null;

    const newPage = input.page === "" || input.page == null ? read.progress_page : Number(input.page);
    const newPercent = input.percent === "" || input.percent == null ? read.progress_percent : Number(input.percent);

    const pagesRead = newPage != null && previousPage != null
      ? Math.max(0, Number(newPage) - Number(previousPage))
      : 0;

    const timestamp = now();
    const speed = input.listening_speed ?? read.listening_speed;

    // Mirror the Update Progress inference: when an audiobook check-in advances
    // the percent, that advance represents listening time on the reconciled day,
    // so record it as a session. Timer sessions already logged that day cover
    // part of the advance and are subtracted; re-saving the same check-in
    // advances nothing, so no duplicate session can be created.
    let inferredSeconds = 0;
    let voidedSeconds = 0;
    if (read.format === "audiobook" && Number.isFinite(newPercent)) {
      const oldPercent = Number(read.progress_percent ?? read.starting_percent ?? 0);
      const deltaPercent = newPercent - oldPercent;
      if (deltaPercent > 0) {
        const bookRuntime = await first(db, "SELECT audiobook_runtime_seconds FROM books WHERE id=?", read.book_id);
        const runtime = Number(read.audiobook_runtime_seconds_snapshot || bookRuntime?.audiobook_runtime_seconds || 0);
        if (runtime > 0) {
          const safeSpeed = Math.max(0.05, Number(speed || 1));
          const expectedSeconds = Math.max(1, Math.round(runtime * (deltaPercent / 100) / safeSpeed));
          const daySessions = await all(db, `SELECT duration_seconds FROM reading_sessions WHERE read_id=? AND local_date=? AND ended_at IS NOT NULL`, read.id, sessionDate);
          const coveredSeconds = daySessions.reduce((sum, session) => sum + Math.max(0, Number(session.duration_seconds || 0)), 0);
          inferredSeconds = Math.max(0, expectedSeconds - coveredSeconds);
        }
      } else if (deltaPercent < 0) {
        // m7: downward correction — void inferred estimates created by the
        // over-reported save (the same-date check-in being replaced, else any
        // save since the previous check-in). Existing rows untouched.
        const sameDate = await first(db, "SELECT reconciled_at FROM daily_checkins WHERE read_id=? AND session_date=?", read.id, sessionDate);
        const sinceIso = sameDate?.reconciled_at || prior?.reconciled_at || read.created_at || timestamp;
        const voided = await voidInferredSince(db, read.id, sinceIso, sessionDate);
        voidedSeconds = voided.adjusted_seconds;
      }
    }

    await db.prepare(`INSERT INTO daily_checkins
      (id,read_id,book_id,session_date,previous_page,new_page,previous_percent,new_percent,pages_read,listening_speed,reconciled_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(read_id,session_date) DO UPDATE SET
        previous_page=excluded.previous_page,
        new_page=excluded.new_page,
        previous_percent=excluded.previous_percent,
        new_percent=excluded.new_percent,
        pages_read=excluded.pages_read,
        listening_speed=excluded.listening_speed,
        reconciled_at=excluded.reconciled_at
    `).bind(
      id("checkin"),read.id,read.book_id,sessionDate,
      previousPage,newPage,previousPercent,newPercent,pagesRead,speed,timestamp
    ).run();

    // Historical reconciliation must never roll the live read-through backward.
    // Only advance the live progress when the reconciled value is ahead.
    const livePage = read.progress_page == null
      ? newPage
      : newPage == null ? read.progress_page : Math.max(Number(read.progress_page), Number(newPage));
    const livePercent = read.progress_percent == null
      ? newPercent
      : newPercent == null ? read.progress_percent : Math.max(Number(read.progress_percent), Number(newPercent));

    await db.prepare("UPDATE read_throughs SET progress_page=?,progress_percent=?,listening_speed=?,updated_at=? WHERE id=?")
      .bind(livePage,livePercent,Number(input.listening_speed || read.listening_speed || 1),timestamp,read.id).run();

    if (inferredSeconds > 0) {
      // Anchor the inferred interval at midday of the reconciled date; the exact
      // clock time is unknown, but local_date is what every view groups by.
      const endedAt = new Date(`${sessionDate}T12:00:00Z`);
      const startedAt = new Date(endedAt.getTime() - inferredSeconds * 1000);
      await db.prepare(`INSERT INTO reading_sessions (id,read_id,book_id,local_date,started_at,ended_at,duration_seconds,listening_speed,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(id("session"),read.id,read.book_id,sessionDate,startedAt.toISOString(),endedAt.toISOString(),inferredSeconds,Math.max(0.05, Number(speed || 1)),"inferred",timestamp).run();
    }

    return json({
      ok:true,
      session_date:sessionDate,
      previous_page:previousPage,
      new_page:newPage,
      pages_read:pagesRead,
      previous_percent:previousPercent,
      new_percent:newPercent,
      inferred_duration_seconds:inferredSeconds,
      ...(voidedSeconds ? { voided_inferred_seconds:voidedSeconds } : {})
    });
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
    const existingName = await first(db, "SELECT id FROM custom_shelves WHERE name=? COLLATE NOCASE", name);
    if (existingName) throw new HttpError(409, `A shelf named "${name}" already exists`);
    const shelfId = id("shelf");
    await db.prepare("INSERT INTO custom_shelves (id,name,created_at,updated_at) VALUES (?,?,?,?)").bind(shelfId,name,now(),now()).run();
    return json(await first(db, "SELECT * FROM custom_shelves WHERE id=?", shelfId), 201);
  }

  const shelfMatch = path.match(/^\/api\/shelves\/([^/]+)$/);
  if (shelfMatch && method === "PUT") {
    const input = await parseJson(request);
    const name = String(input.name || "").trim();
    if (!name) throw new HttpError(400, "Shelf name is required");
    const shelf = await first(db, "SELECT id FROM custom_shelves WHERE id=?", shelfMatch[1]);
    if (!shelf) throw new HttpError(404, "Shelf not found");
    const collision = await first(db, "SELECT id FROM custom_shelves WHERE name=? COLLATE NOCASE AND id<>?", name, shelfMatch[1]);
    if (collision) throw new HttpError(409, `A shelf named "${name}" already exists`);
    await db.prepare("UPDATE custom_shelves SET name=?,updated_at=? WHERE id=?").bind(name,now(),shelfMatch[1]).run();
    return json({ ok: true });
  }
  if (shelfMatch && method === "DELETE") {
    const shelf = await first(db, "SELECT id FROM custom_shelves WHERE id=?", shelfMatch[1]);
    if (!shelf) throw new HttpError(404, "Shelf not found");
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
      if (url.pathname === "/widget/currently-reading" && request.method === "GET") {
        await ensureSchema(env.DB);
        return widgetCurrentlyReadingPage(env.DB, url);
      }
      const publicCoverMatch=url.pathname.match(/^\/covers\/([^/]+)$/);
      if(publicCoverMatch && request.method==="GET"){
        await ensureSchema(env.DB);
        const asset=await first(env.DB,"SELECT content_type,data,updated_at FROM book_cover_assets WHERE book_id=?",decodeURIComponent(publicCoverMatch[1]));
        if(!asset)return new Response("Not found",{status:404});
        // D1 returns BLOB columns as byte arrays. Convert explicitly to a
        // Uint8Array so the Response body is the original binary image, not a
        // serialized JavaScript array/string.
        const imageBytes=asset.data instanceof ArrayBuffer
          ? new Uint8Array(asset.data)
          : new Uint8Array(Array.isArray(asset.data)?asset.data:Object.values(asset.data||{}));
        if(!imageBytes.byteLength)return new Response("Cover data is empty",{status:500});
        return new Response(imageBytes,{headers:{"content-type":asset.content_type,"content-length":String(imageBytes.byteLength),"cache-control":"public, max-age=31536000, immutable","etag":`"${asset.updated_at}"`}});
      }
      if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request, env);
      if (url.pathname.startsWith("/api/")) return cors(await handleApi(request, env, url), request, env);
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, app: "Opal Shelf API", version: "0.0.40" });
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
