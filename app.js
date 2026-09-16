const config = window.OPAL_SHELF_CONFIG || {};
const state = { data: null, view: "home", activeTimer: null, timerTick: null, pendingCheckins: [] };
const app = document.querySelector("#app");
const bookDialog = document.querySelector("#book-dialog");
const formDialog = document.querySelector("#form-dialog");
const checkinDialog = document.querySelector("#checkin-dialog");
const sessionDialog = document.querySelector("#session-dialog");

const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const fmtDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};
const longDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total/3600), mins = Math.floor(total%3600/60), secs = total%60;
  return `${hours ? `${hours}:` : ""}${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
};
const fmtDate = (key) => key ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "Present";
const addDateKey = (key, days) => { const [year,month,day]=key.split("-").map(Number); return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10); };
const authors = (book) => book.authors?.join(", ") || "Unknown author";
const runtimeFromFields = (hours, minutes) => Math.max(0,Number(hours||0)*3600+Number(minutes||0)*60);
const cover = (book, className = "cover") => book.cover_url
  ? `<img class="${className}" src="${esc(book.cover_url)}" alt="Cover of ${esc(book.title)}" loading="lazy">`
  : `<div class="${className} placeholder" role="img" aria-label="No cover for ${esc(book.title)}">${esc(book.title)}</div>`;

async function api(path, options = {}) {
  const headers = { ...(options.body ? { "content-type":"application/json" } : {}), ...(options.headers || {}) };
  const token = localStorage.getItem("opalShelfAccessToken") || config.accessToken;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${String(config.apiBaseUrl || "").replace(/\/$/,"")}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => el.classList.remove("show"), 2400);
}

function bookById(id) { return state.data.books.find((book) => book.id === id); }
function readsForBook(id) { return state.data.reads.filter((read) => read.book_id === id).sort((a,b) => b.read_number-a.read_number); }
function activeRead(bookId) { return state.data.reads.find((read) => read.book_id === bookId && read.state === "active"); }
function sessionsForRead(readId) { return state.data.sessions.filter((session) => session.read_id === readId && session.ended_at); }
function todaySeconds(readId) { return sessionsForRead(readId).filter((session) => session.local_date === state.data.today).reduce((sum,session)=>sum+Number(session.duration_seconds||0),0); }
function lifetimeSeconds(bookId) { return state.data.sessions.filter((session) => session.book_id===bookId && session.ended_at).reduce((sum,session)=>sum+Number(session.duration_seconds||0),0); }
function formatLabel(format) { return ({ print:"Physical", ebook:"Ebook", audiobook:"Audiobook", other:"Other" })[format] || "Other"; }
function readLabel(read) { return Number(read.read_number) === 1 ? "Read #1" : `Reread #${Number(read.read_number)-1}`; }
function readDateRange(read) { return `${fmtDate(read.start_date)}–${read.finish_date ? fmtDate(read.finish_date) : "Present"}`; }
function recentActivityTime(read) {
  const sessionTimes=state.data.sessions.filter((session)=>session.read_id===read.id).map((session)=>new Date(session.started_at).getTime()).filter(Number.isFinite);
  return Math.max(new Date(read.updated_at||read.created_at||read.start_date).getTime()||0,...sessionTimes,0);
}
function progress(read, book) {
  if (!read) return 0;
  const totalPages = read.page_count_snapshot ?? book.page_count;
  if (["print","ebook","other"].includes(read.format) && read.progress_page != null && totalPages) return Math.min(100,Math.max(0,Number(read.progress_page)/Number(totalPages)*100));
  if (read.progress_percent != null) return Math.min(100,Math.max(0,Number(read.progress_percent)));
  return read.state === "finished" ? 100 : 0;
}

async function refresh({ checkins = false, focusReadId = null, reopenBookId = null } = {}) {
  state.data = await api(`/api/bootstrap?date=${dateKey()}`);
  state.activeTimer = state.data.sessions.find((session) => !session.ended_at) || null;
  render();
  updateTimerLabels();
  clearInterval(state.timerTick);
  if (state.activeTimer) state.timerTick = setInterval(updateTimerLabels, 1000);
  if (reopenBookId) openBook(reopenBookId);
  else if (focusReadId) requestAnimationFrame(()=>document.querySelector(`[data-read-card="${CSS.escape(focusReadId)}"]`)?.scrollIntoView({block:"nearest",inline:"nearest"}));
  if (checkins) await loadPendingCheckins();
}

function nav(view) {
  state.view = view;
  document.querySelectorAll("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  render();
  app.focus({ preventScroll:true });
  scrollTo({ top:0, behavior:"smooth" });
}

function render() {
  if (!state.data) return;
  app.innerHTML = state.view === "home" ? homeView() : state.view === "history" ? dailyHistoryView() : state.view === "shelf" ? shelfView() : state.view === "goals" ? goalsView() : settingsView();
  bindView();
}

function homeView() {
  const current = state.data.reads.filter((read) => read.state === "active").sort((a,b)=>recentActivityTime(b)-recentActivityTime(a));
  const dash = state.data.dashboard;
  const daily = dash.dailyGoal;
  const dailyNow = daily?.goal_type === "pages" ? dash.todayPages : Math.floor(dash.todaySeconds/60);
  const dailyText = daily ? `${dailyNow} / ${daily.amount} ${daily.goal_type}` : "Not set";
  return `
    <div class="page-head"><div><p class="eyebrow">Today · ${esc(fmtDate(state.data.today))}</p><h1>Current Reads</h1><p class="subtle">Every book you’re reading gets equal room here.</p></div></div>
    ${current.length ? `<div class="current-strip">${current.map(readCard).join("")}</div>` : emptyState("📚","Your current shelf is waiting","Add a book, then start your first read-through.","Add Book")}
    <section class="section" aria-labelledby="dashboard-title">
      <div class="section-title"><h2 id="dashboard-title">Reading dashboard</h2><button class="button ghost small" data-nav="history">View Daily History →</button></div>
      <div class="dashboard">
        ${stat(fmtDuration(dash.todaySeconds),"Reading today")}
        ${stat(`${dash.streak.current} day${dash.streak.current===1?"":"s"}`,`Current streak · best ${dash.streak.longest}`)}
        ${stat(dailyText,"Daily goal")}
        ${stat(`${dash.annual.counted} / ${dash.annualGoal.target_books}`,`${new Date().getFullYear()} books goal`)}
      </div>
    </section>
    ${recentShelf()}`;
}


function compactEstimate(seconds) {
  const total=Math.max(0,Number(seconds||0));
  if(!Number.isFinite(total))return "";
  if(total<60)return "<1m";
  const minutes=Math.max(1,Math.round(total/60));
  const hours=Math.floor(minutes/60);
  const mins=minutes%60;
  if(hours&&mins)return `${hours}h ${mins}m`;
  if(hours)return `${hours}h`;
  return `${mins}m`;
}

function readThroughPagePace(read) {
  if(!read || String(read.format||"").toLowerCase()==="audiobook")return null;
  const sessions=sessionsForRead(read.id).filter(session=>session.ended_at);
  const timedSeconds=sessions.reduce((sum,session)=>sum+Number(session.duration_seconds||0),0);
  if(timedSeconds<=0)return null;

  const checkins=state.data.checkins.filter(checkin=>checkin.read_id===read.id);
  let pages=checkins.reduce((sum,checkin)=>sum+Math.max(0,Number(checkin.pages_read||0)),0);

  if(pages<=0){
    const start=Number(read.starting_page);
    const current=Number(read.progress_page);
    if(Number.isFinite(start)&&Number.isFinite(current)&&current>start)pages=current-start;
  }

  if(pages<=0)return null;
  const pagesPerHour=pages/(timedSeconds/3600);
  return pagesPerHour>0?pagesPerHour:null;
}

function estimatedTimeRemaining(read,book) {
  if(!read||!book||read.state==="finished")return null;
  const format=String(read.format||"").toLowerCase();

  if(format==="audiobook"){
    const runtime=Number(read.audiobook_runtime_seconds_snapshot??book.audiobook_runtime_seconds??0);
    const percent=Math.max(0,Math.min(100,Number(read.progress_percent??read.starting_percent??0)));
    const speed=Math.max(.05,Number(read.listening_speed||1));
    if(runtime<=0||percent>=100)return null;
    const contentRemaining=runtime*((100-percent)/100);
    return {
      seconds:contentRemaining/speed,
      detail:`At ${speed}× · ${fmtDuration(contentRemaining)} content remaining`
    };
  }

  const totalPages=Number(read.page_count_snapshot??book.page_count??0);
  const currentPage=Number(read.progress_page);
  if(totalPages<=0||!Number.isFinite(currentPage)||currentPage>=totalPages)return null;

  const pace=readThroughPagePace(read);
  if(!pace)return null;

  const pagesRemaining=Math.max(0,totalPages-currentPage);
  return {
    seconds:(pagesRemaining/pace)*3600,
    detail:`Based on ${Math.round(pace)} pg/hr · ${pagesRemaining} page${pagesRemaining===1?"":"s"} remaining`
  };
}

function remainingEstimateMarkup(read,book,{detail=false}={}) {
  const estimate=estimatedTimeRemaining(read,book);
  if(!estimate)return "";
  if(detail){
    return `<div class="remaining-detail"><strong>≈ ${compactEstimate(estimate.seconds)} remaining</strong><small>${esc(estimate.detail)}</small></div>`;
  }
  return `<small class="remaining-estimate">≈ ${esc(compactEstimate(estimate.seconds))} remaining</small>`;
}

function readCard(read) {
  const book = bookById(read.book_id);
  if (!book) return "";
  const pct = progress(read,book);
  const isRunning = state.activeTimer?.read_id === read.id;
  const blocked = state.activeTimer && !isRunning;
  const totalPages = read.page_count_snapshot ?? book.page_count;
  let progressLabel = `${Math.round(pct)}% complete`;
  if ((read.format === "print" || read.format === "ebook" || read.format === "other") && read.progress_page != null) progressLabel = `Page ${read.progress_page}${totalPages ? ` of ${totalPages} · ${Math.round(pct)}% complete` : ""}`;
  if(read.format==="audiobook"&&read.audiobook_runtime_seconds_snapshot)progressLabel=`${formatAudioPosition(read.audiobook_runtime_seconds_snapshot*pct/100)} · ${Math.round(pct)}% complete`;
  return `<article class="read-card" data-read-card="${read.id}">
    <button class="cover-button" data-book="${book.id}" aria-label="Open ${esc(book.title)}">${cover(book)}</button>
    <div class="read-info">
      <span class="format-chip">${esc(formatLabel(read.format))}</span>
      <h3>${esc(book.title)}</h3><p class="author">${esc(authors(book))}</p>
      <div class="progress-bar" aria-label="${Math.round(pct)} percent complete"><span style="width:${pct}%"></span></div>
      <small>${esc(progressLabel)}</small><br>
      <small>${fmtDuration(todaySeconds(read.id))} today ${isRunning ? `· <span class="timer" data-timer>00:00</span>` : ""}</small>
      ${remainingEstimateMarkup(read,book)}
    </div>
    <div class="read-actions">
      <button class="button ${isRunning?"danger":"primary"}" data-timer-action="${isRunning?"stop":"start"}" data-read="${read.id}" ${blocked?"disabled":""}>${isRunning?"■ Stop":"▶ Start Reading"}</button>
      <button class="button" data-progress="${read.id}">Update Progress</button>
      <button class="button" data-finish-read="${read.id}">Finish Read</button>
      <button class="button" data-edit-read="${read.id}">Edit Read-through</button>
    </div>
  </article>`;
}


function dailyPagePace(day) {
  // Daily pace = page gains / timed page-reading hours.
  // Audiobook sessions are deliberately excluded from the denominator.
  const pages=Number(day?.pages||0);
  if(pages<=0)return "";

  let seconds=0;
  for(const contribution of day.contributions?.values?.()||[]) {
    const read=state.data.reads.find(candidate=>candidate.id===contribution.readId);
    if(!read || String(read.format||"").toLowerCase()==="audiobook")continue;
    seconds+=Number(contribution.seconds||0);
  }

  if(seconds<=0)return "";
  return `${Math.round(pages/(seconds/3600))} pg/hr`;
}

function dailyHistoryRows() {
  const days=new Map();
  const ensureDay=(key)=>{
    if(!days.has(key))days.set(key,{date:key,totalSeconds:0,pages:0,contributions:new Map()});
    return days.get(key);
  };
  state.data.sessions.filter((session)=>session.ended_at).forEach((session)=>{
    const day=ensureDay(session.local_date);
    const seconds=Number(session.duration_seconds||0);
    day.totalSeconds+=seconds;
    if(!day.contributions.has(session.read_id))day.contributions.set(session.read_id,{readId:session.read_id,bookId:session.book_id,seconds:0,count:0,speeds:new Set(),checkin:null});
    const contribution=day.contributions.get(session.read_id);
    contribution.seconds+=seconds;
    contribution.count+=1;
    if(session.listening_speed!=null)contribution.speeds.add(Number(session.listening_speed));
  });
  state.data.checkins.forEach((checkin)=>{
    const day=days.get(checkin.session_date);
    if(!day)return;
    day.pages+=Number(checkin.pages_read||0);
    if(!day.contributions.has(checkin.read_id))day.contributions.set(checkin.read_id,{readId:checkin.read_id,bookId:checkin.book_id,seconds:0,count:0,speeds:new Set(),checkin:null});
    day.contributions.get(checkin.read_id).checkin=checkin;
  });
  return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
}

function dailyGoalForDate(day) {
  return [...state.data.goals].filter((goal)=>goal.effective_date<=day.date).sort((a,b)=>b.effective_date.localeCompare(a.effective_date))[0]||null;
}

function dayGoalLine(day) {
  const goal=dailyGoalForDate(day);
  if(!goal)return "No daily goal was set";
  if(goal.paused)return "Daily goal was paused";
  const actual=goal.goal_type==="minutes"?day.totalSeconds:day.pages;
  const target=goal.goal_type==="minutes"?Number(goal.amount)*60:Number(goal.amount);
  const met=actual>=target;
  if(goal.goal_type==="minutes")return `${goal.amount}m goal • ${met?"Met":`${fmtDuration(target-actual)} short`}`;
  return `${goal.amount} page goal • ${met?"Met":`${target-actual} pages short`}`;
}

function progressChangeLine(contribution,read,book) {
  const checkin=contribution.checkin;
  if(!checkin)return "";
  const parts=[];
  if(checkin.previous_page!=null&&checkin.new_page!=null)parts.push(`Page ${checkin.previous_page} → ${checkin.new_page}${Number(checkin.pages_read)>0?` (+${checkin.pages_read})`:""}`);
  const pageTotal=Number(read?.page_count_snapshot??book?.page_count??0);
  if(read?.format!=="audiobook"&&pageTotal&&checkin.previous_page!=null&&checkin.new_page!=null) {
    const previousPct=Math.max(0,Math.min(100,Number(checkin.previous_page)/pageTotal*100));
    const newPct=Math.max(0,Math.min(100,Number(checkin.new_page)/pageTotal*100));
    const deltaPct=newPct-previousPct;
    parts.push(`${Math.round(previousPct)}% → ${Math.round(newPct)}%${Math.abs(deltaPct)>=0.5?` (${deltaPct>=0?"+":""}${Math.round(deltaPct)}%)`:""}`);
  } else if(checkin.previous_percent!=null&&checkin.new_percent!=null) {
    parts.push(`${Number(checkin.previous_percent).toFixed(1).replace(/\.0$/,"")}% → ${Number(checkin.new_percent).toFixed(1).replace(/\.0$/,"")}%`);
    const runtime=Number(read?.audiobook_runtime_seconds_snapshot??book?.audiobook_runtime_seconds??0);
    const speed=Number(checkin.listening_speed||0);
    const delta=Math.max(0,Number(checkin.new_percent)-Number(checkin.previous_percent));
    if(read?.format==="audiobook"&&runtime&&speed&&delta)parts.push(`about ${fmtDuration(runtime*delta/100/speed)} actual at ${speed}×`);
  }
  return parts.join(" • ");
}

function dailyHistoryView() {
  const rows=dailyHistoryRows();
  return `<div class="page-head"><div><p class="eyebrow">Reading Dashboard</p><h1>Daily Progress</h1><p class="subtle">Exact completed-session totals, newest first.</p></div><button class="button" data-nav="home">← Home</button></div>
    ${rows.length?`<div class="daily-history">${rows.map((day)=>{
      const relative=day.date===state.data.today?"Today":day.date===addDateKey(state.data.today,-1)?"Yesterday":new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined,{weekday:"long"});
      const contributions=[...day.contributions.values()].sort((a,b)=>b.seconds-a.seconds);
      return `<section class="day-card"><header><div><p class="eyebrow">${esc(relative)}</p><h2>${esc(fmtDate(day.date))}</h2></div><div class="day-total"><strong>${fmtDuration(day.totalSeconds)}${dailyPagePace(day) ? ` · ${dailyPagePace(day)}` : ""}</strong><span>${esc(dayGoalLine(day))}</span></div></header><div class="day-contributions">${contributions.map((item)=>{
        const read=state.data.reads.find((candidate)=>candidate.id===item.readId),book=bookById(item.bookId);
        const speeds=[...item.speeds].sort((a,b)=>a-b);
        const progressLine=progressChangeLine(item,read,book);
        return `<article class="day-book"><div><strong>${esc(book?.title||"Unknown book")}</strong><span>${read?esc(readLabel(read)):"Read-through"} • ${item.count} session${item.count===1?"":"s"}${speeds.length?` • ${speeds.join("× / ")}×`:""}</span>${progressLine?`<small>${esc(progressLine)}</small>`:""}</div><b>${fmtDuration(item.seconds)}</b></article>`;
      }).join("")}</div></section>`;
    }).join("")}</div>`:emptyState("◷","No completed sessions yet","Finished timer sessions will appear here by local calendar day.","")}`;
}

function recentShelf() {
  const books = state.data.books.filter((book)=>book.status!=="dnf").slice(0,8);
  return `<section class="section"><div class="section-title"><h2>On your shelf</h2><button class="button ghost small" data-nav="shelf">View all →</button></div>
    ${books.length ? bookshelf("Your Library",books) : ""}</section>`;
}

function shelfView() {
  const visible = state.data.books.filter((book)=>book.status!=="dnf");
  const reading = visible.filter((book)=>book.status==="reading");
  const want = visible.filter((book)=>book.status==="want");
  const finished = visible.filter((book)=>book.status==="finished");
  const custom = state.data.shelves.map((shelf)=>[shelf.name, visible.filter((book)=>state.data.memberships.some((m)=>m.shelf_id===shelf.id&&m.book_id===book.id)),shelf]);

  return `<div class="page-head"><div><p class="eyebrow">The whole collection</p><h1>Your Shelf</h1><p class="subtle">Current reads stay face-out. Want to Read and Finished live on the shelf as spines — tap one to pull it out and see the front.</p></div><button class="button" id="new-shelf">＋ New Shelf</button></div>
    ${reading.length ? bookshelf("Reading",reading) : ""}
    ${want.length ? spineBookshelf("Want to Read",want,"want") : ""}
    ${finished.length ? spineBookshelf("Finished Reading",finished,"finished") : ""}
    ${custom.map(([name,books,shelf])=>bookshelf(name,books,shelf)).join("")}
    ${!reading.length&&!want.length&&!finished.length&&!custom.length ? emptyState("▥","No books yet","Add your first book to begin building the shelf.","Add Book") : ""}
    <section class="section"><div class="section-title"><h2>Book Archive</h2><span class="subtle">Includes DNF</span></div>
      <div class="panel">${state.data.books.length ? state.data.books.map((book)=>`<button class="button ghost full" data-book="${book.id}" style="text-align:left">${esc(book.title)} — ${esc(authors(book))} <span class="status-chip">${esc(book.status)}</span></button>`).join("") : "No archived books."}</div>
    </section>`;
}

function bookshelf(name, books, shelf) {
  return `<section class="shelf-unit"><div class="shelf-label"><h2>${esc(name)}</h2>${shelf?`<span><button class="button ghost small" data-rename-shelf="${shelf.id}">Rename</button><button class="button ghost small danger" data-delete-shelf="${shelf.id}">Delete</button></span>`:""}</div>
    <div class="books-row">${books.length ? books.map((book)=>`<button class="shelf-book" data-book="${book.id}">${cover(book)}<strong>${esc(book.title)}</strong></button>`).join("") : `<p class="subtle">No books here yet.</p>`}</div><div class="shelf-board"></div></section>`;
}

function spineBookshelf(name,books,status) {
  const palette=status==="finished"
    ? ["#615970","#74677f","#82748e","#6b6278","#8d7d98","#706a84"]
    : ["#826f8f","#927b9d","#71869a","#9a7f96","#786f91","#8b819b"];

  return `<section class="shelf-unit spine-shelf"><div class="shelf-label"><h2>${esc(name)}</h2><span class="subtle">${books.length} book${books.length===1?"":"s"}</span></div>
    <div class="spine-row">${books.map((book,index)=>{
      const author=authors(book);
      const spine=palette[index%palette.length];
      return `<button class="book-spine" type="button" data-book="${book.id}" style="--spine:${spine}" aria-label="Pull out ${esc(book.title)}">
        <span class="spine-title">${esc(book.title)}</span>
        ${author?`<span class="spine-author">${esc(author)}</span>`:""}
      </button>`;
    }).join("")}</div><div class="shelf-board spine-board"></div>
    <p class="spine-hint">Tap a spine to pull the book off the shelf.</p></section>`;
}

function goalsView() {
  const daily = state.data.dashboard.dailyGoal;
  const annual = state.data.dashboard.annualGoal;
  return `<div class="page-head"><div><p class="eyebrow">Goals that preserve history</p><h1>Reading Goals</h1><p class="subtle">Changes begin on their effective date. Older streak days keep their original rules.</p></div></div>
    <div class="goal-grid">
      <form class="panel" id="daily-goal-form"><h2>Daily reading</h2>
        <div class="form-grid"><div class="field"><label for="goal-type">Goal type</label><select id="goal-type" name="goal_type"><option value="minutes" ${daily?.goal_type==="minutes"?"selected":""}>Minutes</option><option value="pages" ${daily?.goal_type==="pages"?"selected":""}>Pages</option></select></div>
        <div class="field"><label for="goal-amount">Amount</label><input id="goal-amount" name="amount" type="number" min="1" value="${daily?.amount||20}" required></div>
        <div class="field span-2"><label for="effective-date">Effective date</label><input id="effective-date" name="effective_date" type="date" value="${state.data.today}" required></div></div>
        <label class="checkbox"><input name="paused" type="checkbox" ${daily?.paused?"checked":""}> Pause this goal</label><div class="form-actions"><button class="button primary">Save Daily Goal</button></div>
      </form>
      <form class="panel" id="annual-goal-form"><h2>Books this year</h2>
        <div class="field"><label for="annual-target">${new Date().getFullYear()} book goal</label><input id="annual-target" name="target_books" type="number" min="1" value="${annual.target_books||30}" required></div>
        <label class="checkbox"><input name="count_rereads" type="checkbox" ${annual.count_rereads?"checked":""}> Count rereads toward goal</label>
        <p class="subtle">${state.data.dashboard.annual.completedReads} completed reads · ${state.data.dashboard.annual.uniqueBooks} unique books · ${state.data.dashboard.annual.rereads} rereads</p>
        <div class="form-actions"><button class="button primary">Save Annual Goal</button></div>
      </form>
    </div>
    <section class="section panel"><h2>Goal history</h2>${state.data.goals.length ? `<div class="history-list">${[...state.data.goals].reverse().map((goal)=>`<div class="history-item"><strong>${goal.paused?"Paused":`${goal.amount} ${goal.goal_type} per day`}</strong><br><span class="subtle">Effective ${fmtDate(goal.effective_date)}</span></div>`).join("")}</div>` : `<p class="subtle">No daily goal has been set yet.</p>`}</section>`;
}

function settingsView() {
  return `<div class="page-head"><div><p class="eyebrow">Opal Shelf v0.0.7</p><h1>Settings</h1></div></div>
    <section class="panel"><h2>Connection</h2><p class="subtle">Your books and reading history live in your private Opal Shelf database.</p>
      <form id="token-form"><div class="field"><label for="access-token">Access token (only if enabled on your Worker)</label><input id="access-token" name="token" type="password" autocomplete="off" value="${esc(localStorage.getItem("opalShelfAccessToken")||"")}"></div><div class="form-actions"><button class="button primary">Save Token</button></div></form>
    </section>
    <section class="section panel"><h2>About this foundation</h2><p>Books, read-throughs, individual timer sessions, progress check-ins, daily goal history, annual goals, and custom shelves are stored separately. Starting a reread never replaces the earlier read.</p><p class="subtle">Book search suggestions come from Open Library and remain fully editable.</p></section>`;
}

function stat(value,label) { return `<div class="stat"><span class="value">${esc(value)}</span><span class="label">${esc(label)}</span></div>`; }
function emptyState(icon,title,text,button) { return `<div class="empty"><div class="book-stack">${icon}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>${button?`<button class="button primary" data-empty-add>${esc(button)}</button>`:""}</div>`; }

function bindView() {
  app.querySelectorAll("[data-book]").forEach((el)=>el.addEventListener("click",()=>openBook(el.dataset.book)));
  app.querySelectorAll("[data-nav]").forEach((el)=>el.addEventListener("click",()=>nav(el.dataset.nav)));
  app.querySelectorAll("[data-empty-add]").forEach((el)=>el.addEventListener("click",openAddBook));
  app.querySelectorAll("[data-progress]").forEach((el)=>el.addEventListener("click",()=>openProgress(el.dataset.progress)));
  app.querySelectorAll("[data-edit-read]").forEach((el)=>el.addEventListener("click",()=>openEditRead(el.dataset.editRead)));
  app.querySelectorAll("[data-finish-read]").forEach((el)=>el.addEventListener("click",()=>finishReadFromCard(el.dataset.finishRead)));
  app.querySelectorAll("[data-timer-action]").forEach((el)=>el.addEventListener("click",()=>timerAction(el.dataset.timerAction,el.dataset.read,{focusReadId:el.dataset.read})));
  document.querySelector("#new-shelf")?.addEventListener("click",()=>shelfForm());
  app.querySelectorAll("[data-rename-shelf]").forEach((el)=>el.addEventListener("click",()=>shelfForm(el.dataset.renameShelf)));
  app.querySelectorAll("[data-delete-shelf]").forEach((el)=>el.addEventListener("click",()=>deleteShelf(el.dataset.deleteShelf)));
  document.querySelector("#daily-goal-form")?.addEventListener("submit",saveDailyGoal);
  document.querySelector("#annual-goal-form")?.addEventListener("submit",saveAnnualGoal);
  document.querySelector("#token-form")?.addEventListener("submit",saveToken);
}

function updateTimerLabels() {
  if (!state.activeTimer) return;
  const seconds = Math.max(0,(Date.now()-new Date(state.activeTimer.started_at).getTime())/1000);
  document.querySelectorAll("[data-timer]").forEach((el)=>el.textContent=longDuration(seconds));
}

async function timerAction(action,readId,refreshOptions={}) {
  try {
    if (action === "start") await api("/api/sessions/start",{method:"POST",body:JSON.stringify({read_id:readId,local_date:dateKey(),started_at:new Date().toISOString()})});
    else await api(`/api/sessions/${state.activeTimer.id}/stop`,{method:"POST",body:JSON.stringify({ended_at:new Date().toISOString()})});
    await refresh(refreshOptions);
    toast(action === "start" ? "Reading timer started" : "Session saved");
  } catch (error) { toast(error.message); }
}

function openAddBook(prefill = {}) {
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">Add to your library</p><h1>Add Book</h1>
    <form id="book-search-form"><div class="field"><label for="book-search">Search title, author, ISBN, or ASIN</label><div style="display:flex;gap:8px"><input id="book-search" required><button class="button">Search</button></div></div></form><div id="search-results" class="search-results"></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><form id="book-form">${bookFields(prefill)}<div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Add Book</button></div></form>`);
  document.querySelector("#book-search-form").addEventListener("submit",searchBooks);
  document.querySelector("#book-form").addEventListener("submit",saveBook);
}

function bookFields(book = {}, { editing = false } = {}) {
  const runtime = Number(book.audiobook_runtime_seconds||0);
  const coverRepair = editing
    ? `<div class="field cover-repair"><label>Cover repair</label><button type="button" class="button small" id="find-cover">${book.cover_url ? "Find another cover" : "Find cover"}</button></div>
       ${book.cover_url ? `<label class="checkbox cover-remove"><input name="remove_cover" type="checkbox"> Remove current cover</label>` : ""}`
    : "";
  return `<div class="form-grid">
    ${field("Title","title",book.title,"text",true)}${field("Subtitle","subtitle",book.subtitle)}
    ${field("Author(s), comma separated","authors",book.authors?.join(", "))}${field("Cover image URL","cover_url",book.cover_url,"url")}${coverRepair}
    ${field("Series","series_name",book.series_name)}${field("Series number","series_number",book.series_number,"number")}
    ${field("ISBN","isbn",book.isbn)}${field("ASIN","asin",book.asin)}${field("Publisher","publisher",book.publisher)}
    ${field("Publication date","publication_date",book.publication_date)}${field("Page count","page_count",book.page_count,"number")}
    ${field("Audiobook hours","runtime_hours",Math.floor(runtime/3600),"number")}${field("Audiobook minutes","runtime_minutes",Math.round(runtime%3600/60),"number")}
    ${field("Narrator(s)","narrators",book.narrators?.join(", "))}${field("Language","language",book.language)}
    ${field("Genres / tags","genres",book.genres?.join(", "))}${field("Personal tags","personal_tags",book.personal_tags?.join(", "))}
    <div class="field"><label for="status">Book status</label><select id="status" name="status">${[["want","Want to Read"],["reading","Reading"],["finished","Finished"],["dnf","DNF this Book"]].map(([value,label])=>`<option value="${value}" ${book.status===value?"selected":""}>${label}</option>`).join("")}</select></div>
    ${field("Edition / format notes","format_metadata",book.format_metadata)}
    <div class="field span-2"><label for="description">Description</label><textarea id="description" name="description">${esc(book.description||"")}</textarea></div>
    <label class="checkbox"><input name="favorite" type="checkbox" ${book.favorite?"checked":""}> Favorite</label>
  </div>`;
}

function field(label,name,value="",type="text",required=false) {
  const decimalSpeed = name === "listening_speed" ? ` step="0.05" min="0.05" inputmode="decimal"` : "";
  const decimalPercent = ["percent","progress_percent","starting_percent"].includes(name) ? ` step="any" min="0" max="100" inputmode="decimal"` : "";
  return `<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value??"")}"${decimalSpeed}${decimalPercent} ${required?"required":""}></div>`;
}

function formatAudioPosition(seconds) {
  const totalMinutes=Math.max(0,Math.round(Number(seconds||0)/60));
  return `${Math.floor(totalMinutes/60)}:${String(totalMinutes%60).padStart(2,"0")}`;
}

function parseAudioPosition(value) {
  const match=String(value||"").trim().match(/^(\d+):([0-5]\d)$/);
  return match ? (Number(match[1])*60+Number(match[2]))*60 : null;
}

function bindAudioProgress(form,runtime,{percentName="percent",positionName="content_position",breakdownId="audio-progress-breakdown"}={}) {
  const percentInput=form.elements[percentName],positionInput=form.elements[positionName],speedInput=form.elements.listening_speed;
  if(!runtime||!percentInput||!positionInput)return;
  const updateBreakdown=()=>{const target=document.getElementById(breakdownId);if(target)target.innerHTML=audioBreakdown(runtime,Number(percentInput.value||0),Number(speedInput?.value||1));};
  positionInput.addEventListener("input",()=>{
    if(!positionInput.value.trim()){positionInput.setCustomValidity("");return;}
    const seconds=parseAudioPosition(positionInput.value);
    if(seconds==null||seconds>runtime){positionInput.setCustomValidity(`Use h:mm up to ${formatAudioPosition(runtime)}`);return;}
    positionInput.setCustomValidity("");
    percentInput.value=String(Math.round((seconds/runtime*100 + Number.EPSILON)*100)/100);
    updateBreakdown();
  });
  percentInput.addEventListener("input",()=>{
    const percent=Math.min(100,Math.max(0,Number(percentInput.value||0)));
    positionInput.value=formatAudioPosition(runtime*percent/100);
    positionInput.setCustomValidity("");
    updateBreakdown();
  });
  speedInput?.addEventListener("input",updateBreakdown);
}

async function searchBooks(event) {
  event.preventDefault();
    const searchForm=event.currentTarget;
    const rawQuery=String(searchForm?.querySelector("input")?.value||"").trim();
  const target = document.querySelector("#search-results");
  target.innerHTML = `<p class="subtle">Searching…</p>`;
  try {
    const results = await api(`/api/books/search?q=${encodeURIComponent(event.currentTarget.elements[0].value)}`);
    
    const compact=rawQuery.replace(/[-\s]/g,"");
    const looksAsin=/^[A-Z0-9]{10}$/i.test(compact) && !/^\d{10}$/.test(compact);
    target.innerHTML = results.length ? results.map((book,index)=>`<div class="search-result">${book.cover_url?`<img src="${esc(book.cover_url)}" alt="">`:`<div></div>`}<span><strong>${esc(book.title)}</strong><br><small>${esc(book.authors.join(", "))}${book.source?` · ${esc(book.source)}`:""}</small></span><button class="button small" data-use-result="${index}">Use</button></div>`).join("") : `<p>${looksAsin?"No free-catalog metadata found for this Kindle edition. The ASIN has been copied into the manual form.":"No free-catalog results. Manual entry is available."}</p>`;
    if(!results.length&&looksAsin&&document.querySelector("#book-form")?.elements.asin)document.querySelector("#book-form").elements.asin.value=compact.toUpperCase();
    target.querySelectorAll("[data-use-result]").forEach((button)=>button.addEventListener("click",()=>{
      const chosen=results[Number(button.dataset.useResult)];
      document.querySelector("#book-form").innerHTML=`${bookFields(chosen)}<div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Add Book</button></div>`;
      document.querySelector("#book-form").querySelectorAll("[data-close]").forEach((el)=>el.addEventListener("click",()=>formDialog.close()));
    }));
  } catch (error) { target.innerHTML=`<p class="error-banner">${esc(error.message)} You can still enter the book manually.</p>`; }
}

function formDataObject(form) {
  const data=Object.fromEntries(new FormData(form));
  data.favorite=form.elements.favorite?.checked||false;
  data.remove_cover=form.elements.remove_cover?.checked||false;
  data.audiobook_runtime_seconds=runtimeFromFields(data.runtime_hours,data.runtime_minutes);
  delete data.runtime_hours; delete data.runtime_minutes;
  return data;
}

async function saveBook(event) {
  event.preventDefault();
  try { await api("/api/books",{method:"POST",body:JSON.stringify(formDataObject(event.currentTarget))}); formDialog.close(); await refresh(); toast("Book added to your shelf"); }
  catch(error){ toast(error.message); }
}

function openBook(bookId) {
  const book=bookById(bookId), reads=readsForBook(bookId), active=activeRead(bookId);
  const shelfIds=state.data.memberships.filter((m)=>m.book_id===book.id).map((m)=>m.shelf_id);
  const history=reads.length?reads.map(readHistoryItem).join(""):`<p class="subtle">No reading history yet.</p>`;
  const isRunning=active && state.activeTimer?.read_id===active.id;
  const timerBlocked=state.activeTimer && !isRunning;
  document.querySelector("#book-dialog-content").innerHTML=`<button class="modal-close" data-close aria-label="Close">×</button><div class="detail-head">${cover(book)}<div><span class="status-chip">${esc(book.status)}</span><h1>${esc(book.title)}</h1><p>${esc(book.subtitle||"")}</p><p class="subtle">${esc(authors(book))}</p><p><strong>${fmtDuration(lifetimeSeconds(book.id))}</strong> lifetime timed reading</p></div></div>
    <div class="tag-row">${(book.genres||[]).map((tag)=>`<span class="format-chip">${esc(tag)}</span>`).join("")}</div>
    <p>${esc(book.description||"No description yet.")}</p>
    <div class="form-actions"><button class="button" id="edit-book">Edit Book</button>${!active?`<button class="button primary" id="start-read">${reads.length?"Start Reread":"Start Reading"}</button>`:`
      <button class="button ${isRunning?"danger":"primary"}" data-dialog-timer="${active.id}" ${timerBlocked?"disabled":""}>${isRunning?"■ Stop Timer":"▶ Start Timer"}</button>
      <button class="button" data-progress="${active.id}">Update Progress</button>
      <button class="button" data-dialog-finish="${active.id}">Finish Read</button>
      <button class="button" data-edit-read="${active.id}">Edit Read-through</button>`}</div>
    <section class="section"><h2>Custom shelves</h2>${state.data.shelves.length?state.data.shelves.map((shelf)=>`<label class="checkbox"><input type="checkbox" data-shelf-membership="${shelf.id}" ${shelfIds.includes(shelf.id)?"checked":""}> ${esc(shelf.name)}</label>`).join(""):`<p class="subtle">Create a custom shelf from the Shelf tab.</p>`}</section>
    <section class="section"><h2>Reading history</h2><div class="history-list">${history}</div></section>`;
  if(!bookDialog.open)bookDialog.showModal();
  document.querySelector("#book-dialog-content [data-close]").addEventListener("click",()=>bookDialog.close());
  document.querySelector("#edit-book").addEventListener("click",()=>{bookDialog.close();openEditBook(book);});
  document.querySelector("#start-read")?.addEventListener("click",()=>{bookDialog.close();openStartRead(book);});
  document.querySelector("#book-dialog-content [data-progress]")?.addEventListener("click",(event)=>{bookDialog.close();openProgress(event.currentTarget.dataset.progress);});
  document.querySelector("#book-dialog-content [data-dialog-timer]")?.addEventListener("click",async(event)=>{const action=state.activeTimer?.read_id===event.currentTarget.dataset.dialogTimer?"stop":"start";await timerAction(action,event.currentTarget.dataset.dialogTimer,{reopenBookId:book.id});});
  document.querySelector("#book-dialog-content [data-dialog-finish]")?.addEventListener("click",(event)=>{bookDialog.close();finishReadFromCard(event.currentTarget.dataset.dialogFinish);});
  document.querySelectorAll("#book-dialog-content [data-edit-read]").forEach((el)=>el.addEventListener("click",()=>{bookDialog.close();openEditRead(el.dataset.editRead);}));
  document.querySelectorAll("#book-dialog-content [data-delete-read]").forEach((el)=>el.addEventListener("click",()=>deleteRead(el.dataset.deleteRead,book.id)));
  document.querySelectorAll("[data-shelf-membership]").forEach((input)=>input.addEventListener("change",()=>toggleMembership(input.dataset.shelfMembership,book.id,input.checked)));
}

function sessionTimeLabel(session) {
  const start=new Date(session.started_at);
  const end=session.ended_at?new Date(session.ended_at):null;
  const opts={hour:"numeric",minute:"2-digit"};
  return `${start.toLocaleTimeString([],opts)}${end?`–${end.toLocaleTimeString([],opts)}`:""}`;
}

function timeInputValue(iso) {
  const date=new Date(iso);
  // Native mobile time inputs expect canonical 24-hour HH:MM at minute precision.
  // iOS may display this as 6:40 PM, but the underlying value remains 18:40.
  return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

function sessionDurationInput(seconds) {
  const total=Math.max(0,Math.floor(Number(seconds||0)));
  const hours=Math.floor(total/3600),minutes=Math.floor((total%3600)/60),secs=total%60;
  return `${hours}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
}

function parseSessionDuration(value) {
  const parts=String(value||"").trim().split(":").map(Number);
  if(parts.some((part)=>!Number.isFinite(part)||part<0))return null;
  if(parts.length===3 && parts[1]<60 && parts[2]<60)return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2 && parts[1]<60)return parts[0]*60+parts[1];
  if(parts.length===1)return parts[0];
  return null;
}

function normalizeTimeValue(value) {
  const match=String(value||"").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if(!match)return "";
  const hour=Math.max(0,Math.min(23,Number(match[1])));
  const minute=Math.max(0,Math.min(59,Number(match[2])));
  return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
}

function localDateTimeIso(day,time) {
  const normalized=normalizeTimeValue(time);
  if(!normalized)return null;
  const value=new Date(`${day}T${normalized}:00`);
  return Number.isNaN(value.getTime())?null:value.toISOString();
}

function secondsBetweenLocalTimes(day,startTime,endTime) {
  const start=localDateTimeIso(day,startTime);
  const end=localDateTimeIso(day,endTime);
  if(!start||!end)return null;
  const seconds=Math.round((new Date(end)-new Date(start))/1000);
  return seconds>=0?seconds:null;
}

function updateSessionFormLinks(form,{durationTouchedRef}) {
  const dateInput=form.elements.local_date;
  const startInput=form.elements.started_time;
  const endInput=form.elements.ended_time;
  const durationInput=form.elements.duration_text;
  if(!dateInput||!startInput||!endInput||!durationInput)return;

  // iOS Safari is happiest with minute-precision native time inputs.
  startInput.step=60;
  endInput.step=60;
  startInput.value=normalizeTimeValue(startInput.value);
  endInput.value=normalizeTimeValue(endInput.value);

  const syncDurationFromTimes=()=>{
    if(durationTouchedRef.value)return;
    const seconds=secondsBetweenLocalTimes(dateInput.value,startInput.value,endInput.value);
    if(seconds==null)return;
    durationInput.value=sessionDurationInput(seconds);
  };

  const syncEndFromDuration=()=>{
    const seconds=parseSessionDuration(durationInput.value);
    const startIso=localDateTimeIso(dateInput.value,startInput.value);
    if(seconds==null||!startIso)return;
    const end=new Date(new Date(startIso).getTime()+seconds*1000);
    endInput.value=`${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`;
  };

  startInput.addEventListener("input",()=>{durationTouchedRef.value=false;syncDurationFromTimes();});
  endInput.addEventListener("input",()=>{durationTouchedRef.value=false;syncDurationFromTimes();});
  dateInput.addEventListener("input",()=>{durationTouchedRef.value=false;syncDurationFromTimes();});
  durationInput.addEventListener("input",()=>{durationTouchedRef.value=true;syncEndFromDuration();});

  // Initial fill should always match the visible start/end values.
  durationTouchedRef.value=false;
  syncDurationFromTimes();
}

function reopenAfterSessionEdit({readId,bookId}) {
  if(readId && state.data.reads.some(read=>read.id===readId))openEditRead(readId);
  else if(bookId && bookById(bookId))openBook(bookId);
}

function openEditSession(sessionId,{returnReadId=null,returnBookId=null}={}) {
  const session=state.data.sessions.find(item=>item.id===sessionId);
  if(!session||!session.ended_at)return;
  const read=state.data.reads.find(item=>item.id===session.read_id);
  const book=bookById(session.book_id);
  const originalDuration=Number(session.duration_seconds||0);
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">Session repair · ${esc(book?.title||"Unknown book")}</p><h1>Edit Session</h1><p class="subtle">Changing start/end recalculates duration. If you change duration directly, the start stays fixed and the end time moves.</p><form id="edit-session-form"><div class="form-grid">
    ${field("Date","local_date",session.local_date||dateKey(new Date(session.started_at)),"date",true)}
    ${field("Start time","started_time",timeInputValue(session.started_at),"time",true)}
    ${field("End time","ended_time",timeInputValue(session.ended_at),"time",true)}
    ${field("Duration (h:mm:ss)","duration_text",sessionDurationInput(originalDuration),"text",true)}
    ${read?.format==="audiobook"?field("Listening speed","listening_speed",session.listening_speed??read.listening_speed??1,"number"):""}
  </div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save Session</button></div></form>`);
  const form=document.querySelector("#edit-session-form");
  const originalDurationText=sessionDurationInput(originalDuration);
  const durationTouchedRef={value:false};
  updateSessionFormLinks(form,{durationTouchedRef});
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    const startedAt=localDateTimeIso(data.local_date,data.started_time);
    const endedAt=localDateTimeIso(data.local_date,data.ended_time);
    if(!startedAt||!endedAt){toast("Choose a valid date and time");return;}
    const parsedDuration=parseSessionDuration(data.duration_text);
    if(parsedDuration==null){toast("Use duration like 0:25:30");return;}
    const payload={local_date:data.local_date,started_at:startedAt};
    if(durationTouchedRef.value) payload.duration_seconds=parsedDuration;
    else payload.ended_at=endedAt;
    if(data.listening_speed!=="")payload.listening_speed=Number(data.listening_speed);
    try{
      await api(`/api/sessions/${session.id}`,{method:"PUT",body:JSON.stringify(payload)});
      formDialog.close();
      await refresh();
      reopenAfterSessionEdit({readId:returnReadId||session.read_id,bookId:returnBookId||session.book_id});
      toast("Session updated");
    }catch(error){toast(error.message);}
  });
}

function openAddSession(readId,{returnReadId=null,returnBookId=null}={}) {
  const read=state.data.reads.find(item=>item.id===readId);
  if(!read)return;
  const book=bookById(read.book_id);
  const nowDate=new Date();
  const endTime=timeInputValue(nowDate.toISOString());
  const startDate=new Date(nowDate.getTime()-30*60*1000);
  const startTime=timeInputValue(startDate.toISOString());

  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button>
    <p class="eyebrow">Session repair · ${esc(book?.title||"Unknown book")}</p>
    <h1>Add Session</h1>
    <p class="subtle">For reading you forgot to time. Enter start/end, or edit the duration directly.</p>
    <form id="add-session-form"><div class="form-grid">
      ${field("Date","local_date",dateKey(),"date",true)}
      ${field("Start time","started_time",startTime,"time",true)}
      ${field("End time","ended_time",endTime,"time",true)}
      ${field("Duration (h:mm:ss)","duration_text","0:30:00","text",true)}
      ${read.format==="audiobook"?field("Listening speed","listening_speed",read.listening_speed||1,"number"):""}
    </div>
    <div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Add Session</button></div></form>`);

  const form=document.querySelector("#add-session-form");
  const originalDurationText="0:30:00";
  const durationTouchedRef={value:false};
  updateSessionFormLinks(form,{durationTouchedRef});
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    const startedAt=localDateTimeIso(data.local_date,data.started_time);
    const endedAt=localDateTimeIso(data.local_date,data.ended_time);
    const parsedDuration=parseSessionDuration(data.duration_text);
    if(!startedAt||!endedAt){toast("Choose a valid date and time");return;}
    if(parsedDuration==null){toast("Use duration like 0:25:30");return;}

    const payload={
      read_id:read.id,
      local_date:data.local_date,
      started_at:startedAt
    };
    if(durationTouchedRef.value) payload.duration_seconds=parsedDuration;
    else payload.ended_at=endedAt;
    if(data.listening_speed!=="") payload.listening_speed=Number(data.listening_speed);

    try{
      await api("/api/sessions",{method:"POST",body:JSON.stringify(payload)});
      formDialog.close();
      await refresh();
      reopenAfterSessionEdit({readId:returnReadId||read.id,bookId:returnBookId||read.book_id});
      toast("Session added");
    }catch(error){toast(error.message);}
  });
}

function sessionRows(read) {
  const sessions=sessionsForRead(read.id).sort((a,b)=>new Date(b.started_at)-new Date(a.started_at));
  if(!sessions.length)return `<p class="subtle session-empty">No completed timer sessions for this read-through.</p>`;
  const groups=new Map();
  sessions.forEach(session=>{const key=session.local_date||dateKey(new Date(session.started_at));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(session);});
  return [...groups.entries()].map(([day,items])=>`<div class="session-day"><strong>${fmtDate(day)}</strong>${items.map(session=>`<div class="session-row"><div><span>${esc(sessionTimeLabel(session))}</span><small>${fmtDuration(session.duration_seconds)}${session.listening_speed!=null?` • ${Number(session.listening_speed)}×`:""}</small></div><button type="button" class="session-menu" data-session-menu="${session.id}" aria-label="Session options" title="Session options">•••</button></div>`).join("")}</div>`).join("");
}
function sessionSection(read,{open=false}={}) {
  const count=sessionsForRead(read.id).length;
  return `<details class="session-details" ${open?"open":""}><summary>Sessions <span class="subtle">${count}</span></summary><div class="session-tools"><button type="button" class="button tiny" data-add-session="${read.id}">+ Add session</button></div><div class="session-list">${sessionRows(read)}</div></details>`;
}
function readHistoryItem(read) {
  const timed=fmtDuration(sessionsForRead(read.id).reduce((sum,s)=>sum+Number(s.duration_seconds||0),0));
  const snapshot=read.format==="audiobook"&&read.audiobook_runtime_seconds_snapshot
    ? `${fmtDuration(read.audiobook_runtime_seconds_snapshot)} audiobook snapshot`
    : read.page_count_snapshot ? `${read.page_count_snapshot} page snapshot` : "No length snapshot";
  return `<article class="history-item"><div class="history-summary"><div><strong>${readLabel(read)} • ${readDateRange(read)} • ${esc(formatLabel(read.format))}</strong><br><span class="status-chip">${read.state==="active"?"Reading":read.state==="paused"?"Paused":esc(read.state)}</span> <span class="subtle">${timed} timed • ${snapshot}</span>${read.notes?`<p class="read-notes">${esc(read.notes)}</p>`:""}</div><div class="history-actions"><button class="button small" data-edit-read="${read.id}">Edit Read-through</button><button class="button small danger" data-delete-read="${read.id}">Delete</button></div></div>${readThroughSummary(read)}${sessionSection(read)}</article>`;
}

function openEditBook(book) {
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">Book metadata</p><h1>Edit Book</h1><form id="edit-book-form">${bookFields(book,{editing:true})}<details class="danger-zone"><summary>Advanced book management</summary><div class="danger-zone-inner"><p class="subtle">Permanent actions live here so they are harder to tap accidentally.</p><button type="button" class="button danger" id="delete-book">Delete book permanently</button></div></details><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save Changes</button></div></form>`);
  const form=document.querySelector("#edit-book-form");
  document.querySelector("#find-cover")?.addEventListener("click",async()=>{
    const query=[form.elements.title?.value,form.elements.authors?.value].filter(Boolean).join(" ").trim();
    if(!query){toast("Add a title or author first");return;}
    try{
      const results=await api(`/api/books/search?q=${encodeURIComponent(query)}`);
      const match=results.find(item=>item.cover_url);
      if(!match){toast("No cover found");return;}
      form.elements.cover_url.value=match.cover_url;
      if(form.elements.remove_cover)form.elements.remove_cover.checked=false;
      toast("Cover found — save changes to keep it");
    }catch(error){toast(error.message);}
  });
  document.querySelector("#delete-book")?.addEventListener("click",async()=>{
    const reads=readsForBook(book.id);
    const detail=reads.length?` This also permanently deletes ${reads.length} read-through${reads.length===1?"":"s"}, their progress history, and reading sessions.`:"";
    if(!confirm(`Permanently delete "${book.title}" from Opal Shelf?${detail}`))return;
    if(!confirm(`Final confirmation: delete "${book.title}"? This cannot be undone.`))return;
    try{
      await api(`/api/books/${book.id}`,{method:"DELETE"});
      formDialog.close();
      await refresh();
      toast("Book permanently deleted");
    }catch(error){toast(error.message);}
  });
  form.addEventListener("submit",async(event)=>{event.preventDefault();try{
    const data=formDataObject(event.currentTarget);
    if(!data.remove_cover && !String(data.cover_url||"").trim() && book.cover_url)data.cover_url=book.cover_url;
    await api(`/api/books/${book.id}`,{method:"PUT",body:JSON.stringify(data)});
    formDialog.close();await refresh();toast("Book updated");
  }catch(error){toast(error.message);}});
}

function openStartRead(book) {
  const defaultFormat=book.audiobook_runtime_seconds?"audiobook":"print";
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">A new read-through</p><h1>${readsForBook(book.id).length?"Start Reread":"Start Reading"}</h1><p>${esc(book.title)}</p><form id="start-read-form"><div class="form-grid"><div class="field"><label for="read-format">Format</label><select id="read-format" name="format"><option value="print" ${defaultFormat==="print"?"selected":""}>Physical</option><option value="ebook">Ebook</option><option value="audiobook" ${defaultFormat==="audiobook"?"selected":""}>Audiobook</option><option value="other">Other</option></select></div>${field("Start date","start_date",state.data.today,"date",true)}${field("Starting page","starting_page","","number")}${field("Starting percent","starting_percent","","number")}${field("Listening speed","listening_speed",1,"number")}<div class="field span-2"><label for="read-notes">Read-through notes</label><textarea id="read-notes" name="notes" placeholder="Edition, reason for rereading, or anything specific to this read"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Begin Read-Through</button></div></form>`);
  document.querySelector("#start-read-form").addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.book_id=book.id;data.local_date=state.data.today;try{await api("/api/reads",{method:"POST",body:JSON.stringify(data)});formDialog.close();await refresh();toast("New read-through started");}catch(error){toast(error.message);}});
}


function bindPageProgress(form,pageTotal) {
  const pageInput=form.elements.page;
  const percentInput=form.elements.percent;
  const total=Number(pageTotal||0);
  if(!pageInput||!percentInput||!total)return;

  percentInput.step="any";
  percentInput.min="0";
  percentInput.max="100";
  pageInput.min="0";
  pageInput.max=String(total);

  let syncing=false;

  const syncPercentFromPage=()=>{
    if(syncing)return;
    const page=Number(pageInput.value);
    if(!Number.isFinite(page))return;
    syncing=true;
    const pct=Math.max(0,Math.min(100,page/total*100));
    percentInput.value=String(Math.round((pct+Number.EPSILON)*100)/100);
    syncing=false;
  };

  const syncPageFromPercent=()=>{
    if(syncing)return;
    const pct=Number(percentInput.value);
    if(!Number.isFinite(pct))return;
    syncing=true;
    const page=Math.max(0,Math.min(total,Math.round(total*pct/100)));
    pageInput.value=String(page);
    syncing=false;
  };

  pageInput.addEventListener("input",syncPercentFromPage);
  percentInput.addEventListener("input",syncPageFromPercent);

  // Normalize whatever is already saved when the form opens.
  if(pageInput.value!=="" && Number.isFinite(Number(pageInput.value))) syncPercentFromPage();
  else if(percentInput.value!=="" && Number.isFinite(Number(percentInput.value))) syncPageFromPercent();
}

function openProgress(readId) {
  const read=state.data.reads.find((item)=>item.id===readId), book=bookById(read.book_id);
  const audioRuntime=read.audiobook_runtime_seconds_snapshot??book.audiobook_runtime_seconds;
  const pageTotal=read.page_count_snapshot??book.page_count;
  const audioFields=read.format==="audiobook"?`${field("Percent complete","percent",read.progress_percent??0,"number")}${audioRuntime?field("Content position (h:mm)","content_position",formatAudioPosition(audioRuntime*Number(read.progress_percent||0)/100)):""}${field("Listening speed","listening_speed",read.listening_speed||1,"number")}`:"";
  const standardFields=read.format!=="audiobook"
    ? `${field("Current page","page",read.progress_page,"number")}${pageTotal?field("Percent complete","percent",read.progress_percent??(Number(read.progress_page||0)/Number(pageTotal)*100),"number"):field("Percent complete","percent",read.progress_percent,"number")}`
    : "";
  const audio=read.format==="audiobook"&&audioRuntime?`<div id="audio-progress-breakdown">${audioBreakdown(audioRuntime,read.progress_percent||0,read.listening_speed||1)}</div>`:"";
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">${readLabel(read)}</p><h1>Update Progress</h1><p>${esc(book.title)}</p><form id="progress-form"><div class="form-grid">${audioFields||standardFields}</div>${audio}<div class="form-actions"><button type="button" class="button danger" id="mark-dnf">DNF This Read</button><button type="button" class="button" id="mark-finished">Finish Read</button><button class="button primary">Save Progress</button></div></form>`);
  const form=document.querySelector("#progress-form");
  if(read.format==="audiobook"&&audioRuntime)bindAudioProgress(form,Number(audioRuntime));
  if(read.format!=="audiobook"&&pageTotal)bindPageProgress(form,Number(pageTotal));
  form.addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));data.local_date=state.data.today;try{const result=await api(`/api/reads/${read.id}/progress`,{method:"PUT",body:JSON.stringify(data)});formDialog.close();await refresh();toast(result.inferred_duration_seconds?`Progress updated · ${fmtDuration(result.inferred_duration_seconds)} added today`:"Progress updated");}catch(error){toast(error.message);}});
  document.querySelector("#mark-finished").addEventListener("click",()=>{if(confirm(`Finish ${readLabel(read)} today?`))completeRead(read,"finish");});
  document.querySelector("#mark-dnf").addEventListener("click",()=>{if(confirm(`Mark only ${readLabel(read)} as DNF? The underlying book and earlier reads will be kept.`))completeRead(read,"dnf");});
}

function audioBreakdown(runtime,percent,speed=1) { const safePercent=Math.min(100,Math.max(0,Number(percent||0)));const elapsed=Math.round(runtime*safePercent/100);const remaining=Math.max(0,runtime-elapsed);return `<p class="panel audio-math" style="margin-top:14px"><strong>${safePercent.toFixed(1).replace(/\.0$/,"")}% complete · ${formatAudioPosition(elapsed)} position</strong><br>${fmtDuration(elapsed)} content elapsed · ${fmtDuration(remaining)} content remaining<br><span class="subtle">At ${Number(speed||1)}×: about ${fmtDuration(remaining/Number(speed||1))} actual listening remaining</span></p>`; }
async function completeRead(read,action){try{if(state.activeTimer?.read_id===read.id)await api(`/api/sessions/${state.activeTimer.id}/stop`,{method:"POST",body:JSON.stringify({ended_at:new Date().toISOString()})});await api(`/api/reads/${read.id}/${action}`,{method:"POST",body:JSON.stringify({local_date:state.data.today,finish_date:state.data.today})});formDialog.close();await refresh();toast(action==="finish"?"Read-through finished":"This read-through was marked DNF; the book remains available");}catch(error){toast(error.message);}}

async function finishReadFromCard(readId){const read=state.data.reads.find((item)=>item.id===readId);if(!read)return;if(!confirm(`Finish ${readLabel(read)} today?`))return;await completeRead(read,"finish");}


function readThroughSummary(read) {
  const sessions=sessionsForRead(read.id).filter(s=>s.ended_at);
  const checkins=state.data.checkins.filter(c=>c.read_id===read.id);
  const readingDates=new Set([...sessions.map(s=>s.local_date),...checkins.filter(c=>Number(c.pages_read||0)>0).map(c=>c.session_date)].filter(Boolean));
  const timed=sessions.reduce((sum,s)=>sum+Number(s.duration_seconds||0),0);
  const activeDays=Number(read.active_days||0);
  const format=String(read.format||"").toLowerCase();
  const stats=[];

  if(format==="audiobook") {
    const runtime=Number(read.audiobook_runtime_seconds_snapshot||0);
    const startPct=Number(read.starting_percent||0);
    const endPct=read.state==="finished"?100:Number(read.final_percent??read.progress_percent??startPct);
    const content=Math.max(0,runtime*((endPct-startPct)/100));
    if(runtime>0)stats.push([fmtDuration(runtime),"book length"]);
    if(timed>0)stats.push([fmtDuration(timed),"actual listening"]);
    if(content>0&&timed>0)stats.push([`${(content/timed).toFixed(2)}×`,"effective speed"]);
  } else {
    const pagesFromCheckins=checkins.reduce((sum,c)=>sum+Math.max(0,Number(c.pages_read||0)),0);
    const start=Number(read.starting_page);
    const end=Number(read.final_page??read.progress_page);
    const pages=pagesFromCheckins>0?pagesFromCheckins:(Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):0);
    if(timed>0)stats.push([fmtDuration(timed),"timed reading"]);
    if(pages>0)stats.push([String(pages),"pages read"]);
    if(pages>0&&timed>0)stats.push([`${Math.round(pages/(timed/3600))} pg/hr`,"average pace"]);
  }
  stats.push([String(readingDates.size),`reading day${readingDates.size===1?"":"s"}`]);
  if(activeDays>0)stats.push([String(activeDays),`active day${activeDays===1?"":"s"}`]);

  const book=bookById(read.book_id);
  return `<section class="read-summary"><p class="eyebrow">Read-through summary</p><div class="read-summary-grid">${stats.map(([value,label])=>`<span><strong>${esc(value)}</strong><small>${esc(label)}</small></span>`).join("")}</div>${remainingEstimateMarkup(read,book,{detail:true})}${activeDays>0?`<p class="subtle">Active days include days you simply didn’t read. Explicit Paused/DNF time is excluded; resuming this read-through starts counting active days again.</p>`:""}</section>`;
}

function openEditRead(readId) {
  const read=state.data.reads.find((item)=>item.id===readId), book=read&&bookById(read.book_id);
  if(!read||!book)return;
  const audioRuntime=Number(read.audiobook_runtime_seconds_snapshot??book.audiobook_runtime_seconds??0);
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">${readLabel(read)} · ${esc(book.title)}</p><h1>Edit Read-through</h1><p class="subtle">Changes here affect only this reading record. Book title, author, and series remain under Edit Book.</p><form id="edit-read-form"><div class="form-grid">
    ${field("Start date","start_date",read.start_date,"date",true)}${field("Finish date","finish_date",read.finish_date,"date")}
    <div class="field"><label for="read-state">Status</label><select id="read-state" name="state"><option value="active" ${read.state==="active"?"selected":""}>Reading</option><option value="paused" ${read.state==="paused"?"selected":""}>Paused</option><option value="finished" ${read.state==="finished"?"selected":""}>Finished</option><option value="dnf" ${read.state==="dnf"?"selected":""}>DNF This Read</option></select></div>
    <div class="field"><label for="edit-read-format">Format</label><select id="edit-read-format" name="format"><option value="print" ${read.format==="print"?"selected":""}>Physical</option><option value="ebook" ${read.format==="ebook"?"selected":""}>Ebook</option><option value="audiobook" ${read.format==="audiobook"?"selected":""}>Audiobook</option><option value="other" ${read.format==="other"?"selected":""}>Other</option></select></div>
    ${field("Current page","progress_page",read.progress_page,"number")}${field("Current percent","progress_percent",read.progress_percent,"number")}${read.format==="audiobook"&&audioRuntime?field("Content position (h:mm)","edit_content_position",formatAudioPosition(audioRuntime*Number(read.progress_percent||0)/100)):""}
    ${field("Listening speed","listening_speed",read.listening_speed||1,"number")}${field("Edition page-count snapshot","page_count_snapshot",read.page_count_snapshot,"number")}
    ${field("Audiobook snapshot hours","snapshot_hours",Math.floor(audioRuntime/3600),"number")}${field("Audiobook snapshot minutes","snapshot_minutes",Math.round(audioRuntime%3600/60),"number")}
    <div class="field span-2"><label for="edit-read-notes">Read-through notes</label><textarea id="edit-read-notes" name="notes">${esc(read.notes||"")}</textarea></div>
  </div>${readThroughSummary(read)}${sessionSection(read,{open:true})}<p class="subtle">Changing Paused, Finished, or DNF back to Reading resumes/repairs this same read-through. It does not create a new reread.</p><div class="form-actions"><button type="button" class="button danger" id="delete-read-from-edit">Delete Read-through</button><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save Read-through</button></div></form>`);
  const form=document.querySelector("#edit-read-form");
  if(read.format==="audiobook"&&audioRuntime)bindAudioProgress(form,audioRuntime,{percentName:"progress_percent",positionName:"edit_content_position",breakdownId:"unused-audio-breakdown"});
  form.addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));data.audiobook_runtime_seconds_snapshot=runtimeFromFields(data.snapshot_hours,data.snapshot_minutes);delete data.snapshot_hours;delete data.snapshot_minutes;try{await api(`/api/reads/${read.id}`,{method:"PUT",body:JSON.stringify(data)});formDialog.close();await refresh();toast("Read-through updated");}catch(error){toast(error.message);}});
  document.querySelector("#delete-read-from-edit").addEventListener("click",()=>deleteRead(read.id,book.id));
}

async function deleteRead(readId,bookId){const read=state.data.reads.find((item)=>item.id===readId);if(!read)return;if(state.activeTimer?.read_id===readId){toast("Stop this reading timer before deleting the read-through");return;}if(!confirm(`Delete ${readLabel(read)} and all of its timer sessions and check-ins? The book and other reads will be kept.`))return;try{await api(`/api/reads/${readId}`,{method:"DELETE"});formDialog.close();bookDialog.close();await refresh();toast("Read-through deleted; book and other reads kept");if(bookId&&bookById(bookId))openBook(bookId);}catch(error){toast(error.message);}}

function shelfForm(shelfId) { const shelf=state.data.shelves.find((item)=>item.id===shelfId);formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><h1>${shelf?"Rename":"New"} Shelf</h1><form id="shelf-form">${field("Shelf name","name",shelf?.name||"","text",true)}<div class="form-actions"><button class="button primary">Save Shelf</button></div></form>`);document.querySelector("#shelf-form").addEventListener("submit",async(event)=>{event.preventDefault();const body=JSON.stringify({name:new FormData(event.currentTarget).get("name")});try{await api(shelf?`/api/shelves/${shelf.id}`:"/api/shelves",{method:shelf?"PUT":"POST",body});formDialog.close();await refresh();toast("Shelf saved");}catch(error){toast(error.message);}}); }
async function deleteShelf(id){if(!confirm("Delete this shelf? Its books and reading history will not be deleted."))return;try{await api(`/api/shelves/${id}`,{method:"DELETE"});await refresh();toast("Shelf deleted; books kept");}catch(error){toast(error.message);}}
async function toggleMembership(shelfId,bookId,checked){try{await api(`/api/shelves/${shelfId}/books/${bookId}`,{method:checked?"PUT":"DELETE"});await refresh();toast(checked?"Added to shelf":"Removed from shelf");}catch(error){toast(error.message);}}

async function saveDailyGoal(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.paused=event.currentTarget.elements.paused.checked;try{await api("/api/goals/daily",{method:"POST",body:JSON.stringify(data)});await refresh();toast("Daily goal saved");}catch(error){toast(error.message);}}
async function saveAnnualGoal(event){event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.count_rereads=event.currentTarget.elements.count_rereads.checked;data.year=new Date().getFullYear();try{await api("/api/goals/annual",{method:"POST",body:JSON.stringify(data)});await refresh();toast("Annual goal saved");}catch(error){toast(error.message);}}
function saveToken(event){event.preventDefault();localStorage.setItem("opalShelfAccessToken",new FormData(event.currentTarget).get("token"));toast("Access token saved on this device");refresh().catch(showFatal);}

async function loadPendingCheckins(){try{state.pendingCheckins=await api(`/api/checkins/pending?date=${dateKey()}`);if(state.pendingCheckins.length)showNextCheckin();}catch(error){console.warn(error);}}
function showNextCheckin(){
  const item=state.pendingCheckins[0];
  if(!item)return;
  const runtime=Number(item.audiobook_runtime_seconds_snapshot??item.audiobook_runtime_seconds??0);
  let fields;
  if(item.format==="print"||item.format==="other")fields=field("Where did you finish? Page","page",item.progress_page,"number");
  else if(item.format==="ebook")fields=`${field("Page (optional)","page",item.progress_page,"number")}${field("Progress percent (optional)","percent",item.progress_percent,"number")}`;
  else fields=`${field("Current progress","percent",item.progress_percent??0,"number")}${runtime?field("Content position (h:mm)","content_position",formatAudioPosition(runtime*Number(item.progress_percent||0)/100)):""}${field("Listening speed","listening_speed",item.listening_speed||1,"number")}`;
  const reconciliationLabel=item.session_date===addDateKey(dateKey(),-1)?"Yesterday’s Reading":`Reading on ${fmtDate(item.session_date)}`;
  document.querySelector("#checkin-dialog-content").innerHTML=`<p class="eyebrow">${esc(reconciliationLabel)}</p><h1>${esc(item.title)}</h1><p>You ${item.format==="audiobook"?"listened":"read"} for <strong>${fmtDuration(item.duration_seconds)}</strong> across ${item.session_count} session${item.session_count===1?"":"s"}.</p><p class="subtle">This progress will be saved to <strong>${esc(fmtDate(item.session_date))}</strong>.</p><form id="checkin-form"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="button" id="checkin-later">Later</button><button class="button primary">Save</button></div></form>`;
  checkinDialog.showModal();
  const form=document.querySelector("#checkin-form");
  if(item.format==="audiobook"&&runtime)bindAudioProgress(form,runtime,{breakdownId:"unused-checkin-breakdown"});
  document.querySelector("#checkin-later").addEventListener("click",()=>checkinDialog.close());
  form.addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));Object.assign(data,{read_id:item.read_id,session_date:item.session_date});try{await api("/api/checkins",{method:"POST",body:JSON.stringify(data)});state.pendingCheckins.shift();checkinDialog.close();await refresh();if(state.pendingCheckins.length)showNextCheckin();toast(`Progress saved to ${fmtDate(item.session_date)}`);}catch(error){toast(error.message);}});
}

function formDialogContent(html){document.querySelector("#form-dialog-content").innerHTML=html;formDialog.showModal();document.querySelectorAll("#form-dialog-content [data-close]").forEach((el)=>el.addEventListener("click",()=>formDialog.close()));}
function showFatal(error){app.innerHTML=`<div class="error-banner"><h2>Opal Shelf couldn’t open</h2><p>${esc(error.message)}</p><p>Check the Worker URL in <code>config.js</code> and your access token in Settings.</p><button class="button" id="retry">Try Again</button></div>`;document.querySelector("#retry").addEventListener("click",()=>refresh({checkins:true}).catch(showFatal));}

document.querySelectorAll("[data-nav]").forEach((button)=>button.addEventListener("click",()=>nav(button.dataset.nav)));
document.querySelector("#add-book-button").addEventListener("click",openAddBook);
[bookDialog,formDialog,checkinDialog].forEach((dialog)=>dialog.addEventListener("click",(event)=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh({checkins:true}).catch(showFatal);});
window.addEventListener("focus",()=>refresh({checkins:true}).catch(()=>{}));
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
refresh({checkins:true}).catch(showFatal);

function closeSessionDialog(){ if(sessionDialog.open)sessionDialog.close(); }

function showSessionActions(sessionId) {
  const session=state.data.sessions.find(item=>item.id===sessionId);
  if(!session||!session.ended_at)return;
  const read=state.data.reads.find(item=>item.id===session.read_id);
  const book=bookById(session.book_id);

  document.querySelector("#session-dialog-content").innerHTML=`
    <button class="modal-close" data-session-close aria-label="Close">×</button>
    <p class="eyebrow">Session options</p>
    <h2>${esc(book?.title||"Reading session")}</h2>
    <p class="subtle">${esc(fmtDate(session.local_date))} · ${esc(sessionTimeLabel(session))} · ${esc(fmtDuration(session.duration_seconds))}</p>
    <div class="session-action-list">
      <button type="button" class="button session-action" data-session-action="edit">Edit session</button>
      <button type="button" class="button session-action" data-session-action="move">Move session</button>
      <button type="button" class="button danger session-action" data-session-action="delete">Delete session</button>
    </div>`;

  sessionDialog.showModal();

  document.querySelector("[data-session-close]")?.addEventListener("click",closeSessionDialog);
  document.querySelectorAll("[data-session-action]").forEach(button=>button.addEventListener("click",async()=>{
    const action=button.dataset.sessionAction;
    const editWasOpen=formDialog.open;
    const historyWasOpen=bookDialog.open;
    const historyBookId=read?.book_id;
    closeSessionDialog();

    if(action==="edit"){
      if(editWasOpen)formDialog.close();
      openEditSession(session.id,{returnReadId:editWasOpen?read?.id:null,returnBookId:historyWasOpen?historyBookId:null});
      return;
    }

    if(action==="delete"){
      if(!confirm(`Delete this ${fmtDuration(session.duration_seconds)} session? This will reduce that day's reading total.`))return;
      try{
        await api(`/api/sessions/${session.id}`,{method:"DELETE"});
        await refresh();
        if(editWasOpen&&read)openEditRead(read.id);
        else if(historyWasOpen&&historyBookId)openBook(historyBookId);
        toast("Session deleted");
      }catch(error){toast(error.message);}
      return;
    }

    if(action==="move"){
      showMoveSession(session.id,{returnReadId:editWasOpen?read?.id:null,returnBookId:historyWasOpen?historyBookId:null});
    }
  }));
}

function showMoveSession(sessionId,{returnReadId=null,returnBookId=null}={}) {
  const session=state.data.sessions.find(item=>item.id===sessionId);
  if(!session)return;
  const destinations=state.data.reads.filter(read=>read.id!==session.read_id);
  if(!destinations.length){toast("There is no other read-through to move this session to");return;}

  document.querySelector("#session-dialog-content").innerHTML=`
    <button class="modal-close" data-session-close aria-label="Close">×</button>
    <p class="eyebrow">Move session</p>
    <h2>Choose a read-through</h2>
    <div class="session-destination-list">
      ${destinations.map(read=>{
        const book=bookById(read.book_id);
        return `<button type="button" class="button session-destination" data-move-to="${read.id}">
          <strong>${esc(book?.title||"Unknown book")}</strong>
          <small>${esc(readLabel(read))} · ${esc(readDateRange(read))}</small>
        </button>`;
      }).join("")}
    </div>`;

  sessionDialog.showModal();
  document.querySelector("[data-session-close]")?.addEventListener("click",closeSessionDialog);
  document.querySelectorAll("[data-move-to]").forEach(button=>button.addEventListener("click",async()=>{
    try{
      await api(`/api/sessions/${session.id}`,{method:"PUT",body:JSON.stringify({read_id:button.dataset.moveTo})});
      closeSessionDialog();
      await refresh();
      reopenAfterSessionEdit({readId:returnReadId,bookId:returnBookId});
      toast("Session moved");
    }catch(error){toast(error.message);}
  }));
}


document.addEventListener("click",(event)=>{
  const menuButton=event.target.closest("[data-session-menu]");
  if(menuButton){showSessionActions(menuButton.dataset.sessionMenu);return;}
  const addButton=event.target.closest("[data-add-session]");
  if(addButton){
    const readId=addButton.dataset.addSession;
    const read=state.data.reads.find(item=>item.id===readId);
    const editWasOpen=formDialog.open;
    const historyWasOpen=bookDialog.open;
    if(editWasOpen)formDialog.close();
    openAddSession(readId,{returnReadId:editWasOpen?readId:null,returnBookId:historyWasOpen?read?.book_id:null});
  }
});
