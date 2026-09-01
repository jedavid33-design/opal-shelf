const config = window.OPAL_SHELF_CONFIG || {};
const state = { data: null, view: "home", activeTimer: null, timerTick: null, pendingCheckins: [] };
const app = document.querySelector("#app");
const bookDialog = document.querySelector("#book-dialog");
const formDialog = document.querySelector("#form-dialog");
const checkinDialog = document.querySelector("#checkin-dialog");

const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const fmtDuration = (seconds) => {
  const mins = Math.max(0, Math.round(Number(seconds || 0) / 60));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m`;
};
const longDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total/3600), mins = Math.floor(total%3600/60), secs = total%60;
  return `${hours ? `${hours}:` : ""}${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
};
const fmtDate = (key) => key ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "Present";
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
function progress(read, book) {
  if (!read) return 0;
  if (read.progress_percent != null) return Math.min(100,Math.max(0,Number(read.progress_percent)));
  const totalPages = read.page_count_snapshot ?? book.page_count;
  if (read.progress_page != null && totalPages) return Math.min(100,Math.max(0,Number(read.progress_page)/Number(totalPages)*100));
  return read.state === "finished" ? 100 : 0;
}

async function refresh({ checkins = false } = {}) {
  state.data = await api(`/api/bootstrap?date=${dateKey()}`);
  state.activeTimer = state.data.sessions.find((session) => !session.ended_at) || null;
  render();
  updateTimerLabels();
  clearInterval(state.timerTick);
  if (state.activeTimer) state.timerTick = setInterval(updateTimerLabels, 1000);
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
  app.innerHTML = state.view === "home" ? homeView() : state.view === "shelf" ? shelfView() : state.view === "goals" ? goalsView() : settingsView();
  bindView();
}

function homeView() {
  const current = state.data.reads.filter((read) => read.state === "active");
  const dash = state.data.dashboard;
  const daily = dash.dailyGoal;
  const dailyNow = daily?.goal_type === "pages" ? dash.todayPages : Math.round(dash.todaySeconds/60);
  const dailyText = daily ? `${dailyNow} / ${daily.amount} ${daily.goal_type}` : "Not set";
  return `
    <div class="page-head"><div><p class="eyebrow">Today · ${esc(fmtDate(state.data.today))}</p><h1>Current Reads</h1><p class="subtle">Every book you’re reading gets equal room here.</p></div></div>
    ${current.length ? `<div class="current-strip">${current.map(readCard).join("")}</div>` : emptyState("📚","Your current shelf is waiting","Add a book, then start your first read-through.","Add Book")}
    <section class="section" aria-labelledby="dashboard-title">
      <div class="section-title"><h2 id="dashboard-title">Reading dashboard</h2></div>
      <div class="dashboard">
        ${stat(fmtDuration(dash.todaySeconds),"Reading today")}
        ${stat(`${dash.streak.current} day${dash.streak.current===1?"":"s"}`,`Current streak · best ${dash.streak.longest}`)}
        ${stat(dailyText,"Daily goal")}
        ${stat(`${dash.annual.counted} / ${dash.annualGoal.target_books}`,`${new Date().getFullYear()} books goal`)}
      </div>
    </section>
    ${recentShelf()}`;
}

function readCard(read) {
  const book = bookById(read.book_id);
  if (!book) return "";
  const pct = progress(read,book);
  const isRunning = state.activeTimer?.read_id === read.id;
  const blocked = state.activeTimer && !isRunning;
  const totalPages = read.page_count_snapshot ?? book.page_count;
  let progressLabel = `${Math.round(pct)}% complete`;
  if ((read.format === "print" || read.format === "ebook" || read.format === "other") && read.progress_page != null) progressLabel = `Page ${read.progress_page}${totalPages ? ` of ${totalPages}` : ""}`;
  return `<article class="read-card">
    <button class="ghost" data-book="${book.id}" aria-label="Open ${esc(book.title)}">${cover(book)}</button>
    <div>
      <span class="format-chip">${esc(formatLabel(read.format))}</span>
      <h3>${esc(book.title)}</h3><p class="author">${esc(authors(book))}</p>
      <div class="progress-bar" aria-label="${Math.round(pct)} percent complete"><span style="width:${pct}%"></span></div>
      <small>${esc(progressLabel)}</small><br>
      <small>${fmtDuration(todaySeconds(read.id))} today ${isRunning ? `· <span class="timer" data-timer>00:00</span>` : ""}</small>
    </div>
    <div class="read-actions">
      <button class="button ${isRunning?"danger":"primary"}" data-timer-action="${isRunning?"stop":"start"}" data-read="${read.id}" ${blocked?"disabled":""}>${isRunning?"■ Stop":"▶ Start Reading"}</button>
      <button class="button" data-progress="${read.id}">Update Progress</button>
      <button class="button" data-finish-read="${read.id}">Finish Read</button>
      <button class="button" data-edit-read="${read.id}">Edit Read-through</button>
    </div>
  </article>`;
}

function recentShelf() {
  const books = state.data.books.filter((book)=>book.status!=="dnf").slice(0,8);
  return `<section class="section"><div class="section-title"><h2>On your shelf</h2><button class="button ghost small" data-nav="shelf">View all →</button></div>
    ${books.length ? bookshelf("Your Library",books) : ""}</section>`;
}

function shelfView() {
  const visible = state.data.books.filter((book)=>book.status!=="dnf");
  const system = [
    ["Reading", visible.filter((b)=>b.status==="reading")],
    ["Want to Read", visible.filter((b)=>b.status==="want")],
    ["Finished", visible.filter((b)=>b.status==="finished")]
  ].filter(([,books])=>books.length);
  const custom = state.data.shelves.map((shelf)=>[shelf.name, visible.filter((book)=>state.data.memberships.some((m)=>m.shelf_id===shelf.id&&m.book_id===book.id)),shelf]);
  return `<div class="page-head"><div><p class="eyebrow">The whole collection</p><h1>Your Shelf</h1><p class="subtle">DNF books stay searchable in Book Archive, but off the visual shelves.</p></div><button class="button" id="new-shelf">＋ New Shelf</button></div>
    ${system.length||custom.length ? [...system,...custom].map(([name,books,shelf])=>bookshelf(name,books,shelf)).join("") : emptyState("▥","No books yet","Add your first book to begin building the shelf.","Add Book")}
    <section class="section"><div class="section-title"><h2>Book Archive</h2><span class="subtle">Includes DNF</span></div>
      <div class="panel">${state.data.books.length ? state.data.books.map((book)=>`<button class="button ghost full" data-book="${book.id}" style="text-align:left">${esc(book.title)} — ${esc(authors(book))} <span class="status-chip">${esc(book.status)}</span></button>`).join("") : "No archived books."}</div>
    </section>`;
}

function bookshelf(name, books, shelf) {
  return `<section class="shelf-unit"><div class="shelf-label"><h2>${esc(name)}</h2>${shelf?`<span><button class="button ghost small" data-rename-shelf="${shelf.id}">Rename</button><button class="button ghost small danger" data-delete-shelf="${shelf.id}">Delete</button></span>`:""}</div>
    <div class="books-row">${books.length ? books.map((book)=>`<button class="shelf-book" data-book="${book.id}">${cover(book)}<strong>${esc(book.title)}</strong></button>`).join("") : `<p class="subtle">No books here yet.</p>`}</div><div class="shelf-board"></div></section>`;
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
  return `<div class="page-head"><div><p class="eyebrow">Opal Shelf v0.0.2</p><h1>Settings</h1></div></div>
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
  app.querySelectorAll("[data-timer-action]").forEach((el)=>el.addEventListener("click",()=>timerAction(el.dataset.timerAction,el.dataset.read)));
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

async function timerAction(action,readId) {
  try {
    if (action === "start") await api("/api/sessions/start",{method:"POST",body:JSON.stringify({read_id:readId,local_date:dateKey(),started_at:new Date().toISOString()})});
    else await api(`/api/sessions/${state.activeTimer.id}/stop`,{method:"POST",body:JSON.stringify({ended_at:new Date().toISOString()})});
    await refresh();
    toast(action === "start" ? "Reading timer started" : "Session saved");
  } catch (error) { toast(error.message); }
}

function openAddBook(prefill = {}) {
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">Add to your library</p><h1>Add Book</h1>
    <form id="book-search-form"><div class="field"><label for="book-search">Search title, author, or ISBN</label><div style="display:flex;gap:8px"><input id="book-search" required><button class="button">Search</button></div></div></form><div id="search-results" class="search-results"></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><form id="book-form">${bookFields(prefill)}<div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Add Book</button></div></form>`);
  document.querySelector("#book-search-form").addEventListener("submit",searchBooks);
  document.querySelector("#book-form").addEventListener("submit",saveBook);
}

function bookFields(book = {}) {
  const runtime = Number(book.audiobook_runtime_seconds||0);
  return `<div class="form-grid">
    ${field("Title","title",book.title,"text",true)}${field("Subtitle","subtitle",book.subtitle)}
    ${field("Author(s), comma separated","authors",book.authors?.join(", "))}${field("Cover image URL","cover_url",book.cover_url,"url")}
    ${field("Series","series_name",book.series_name)}${field("Series number","series_number",book.series_number,"number")}
    ${field("ISBN","isbn",book.isbn)}${field("Publisher","publisher",book.publisher)}
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

function field(label,name,value="",type="text",required=false) { return `<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value??"")}" ${required?"required":""}></div>`; }

async function searchBooks(event) {
  event.preventDefault();
  const target = document.querySelector("#search-results");
  target.innerHTML = `<p class="subtle">Searching…</p>`;
  try {
    const results = await api(`/api/books/search?q=${encodeURIComponent(event.currentTarget.elements[0].value)}`);
    target.innerHTML = results.length ? results.map((book,index)=>`<div class="search-result">${book.cover_url?`<img src="${esc(book.cover_url)}" alt="">`:`<div></div>`}<span><strong>${esc(book.title)}</strong><br><small>${esc(book.authors.join(", "))}</small></span><button class="button small" data-use-result="${index}">Use</button></div>`).join("") : `<p>No results. Manual entry is always available.</p>`;
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
  bookDialog.showModal();
  document.querySelector("#book-dialog-content [data-close]").addEventListener("click",()=>bookDialog.close());
  document.querySelector("#edit-book").addEventListener("click",()=>{bookDialog.close();openEditBook(book);});
  document.querySelector("#start-read")?.addEventListener("click",()=>{bookDialog.close();openStartRead(book);});
  document.querySelector("#book-dialog-content [data-progress]")?.addEventListener("click",(event)=>{bookDialog.close();openProgress(event.currentTarget.dataset.progress);});
  document.querySelector("#book-dialog-content [data-dialog-timer]")?.addEventListener("click",async(event)=>{const action=state.activeTimer?.read_id===event.currentTarget.dataset.dialogTimer?"stop":"start";bookDialog.close();await timerAction(action,event.currentTarget.dataset.dialogTimer);});
  document.querySelector("#book-dialog-content [data-dialog-finish]")?.addEventListener("click",(event)=>{bookDialog.close();finishReadFromCard(event.currentTarget.dataset.dialogFinish);});
  document.querySelectorAll("#book-dialog-content [data-edit-read]").forEach((el)=>el.addEventListener("click",()=>{bookDialog.close();openEditRead(el.dataset.editRead);}));
  document.querySelectorAll("#book-dialog-content [data-delete-read]").forEach((el)=>el.addEventListener("click",()=>deleteRead(el.dataset.deleteRead,book.id)));
  document.querySelectorAll("[data-shelf-membership]").forEach((input)=>input.addEventListener("change",()=>toggleMembership(input.dataset.shelfMembership,book.id,input.checked)));
}

function readHistoryItem(read) {
  const timed=fmtDuration(sessionsForRead(read.id).reduce((sum,s)=>sum+Number(s.duration_seconds||0),0));
  const snapshot=read.format==="audiobook"&&read.audiobook_runtime_seconds_snapshot
    ? `${fmtDuration(read.audiobook_runtime_seconds_snapshot)} audiobook snapshot`
    : read.page_count_snapshot ? `${read.page_count_snapshot} page snapshot` : "No length snapshot";
  return `<article class="history-item"><div class="history-summary"><div><strong>${readLabel(read)} • ${readDateRange(read)} • ${esc(formatLabel(read.format))}</strong><br><span class="status-chip">${read.state==="active"?"Reading":esc(read.state)}</span> <span class="subtle">${timed} timed • ${snapshot}</span>${read.notes?`<p class="read-notes">${esc(read.notes)}</p>`:""}</div><div class="history-actions"><button class="button small" data-edit-read="${read.id}">Edit Read-through</button><button class="button small danger" data-delete-read="${read.id}">Delete</button></div></div></article>`;
}

function openEditBook(book) {
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">Book metadata</p><h1>Edit Book</h1><form id="edit-book-form">${bookFields(book)}<div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save Changes</button></div></form>`);
  document.querySelector("#edit-book-form").addEventListener("submit",async(event)=>{event.preventDefault();try{await api(`/api/books/${book.id}`,{method:"PUT",body:JSON.stringify(formDataObject(event.currentTarget))});formDialog.close();await refresh();toast("Book updated");}catch(error){toast(error.message);}});
}

function openStartRead(book) {
  const defaultFormat=book.audiobook_runtime_seconds?"audiobook":"print";
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">A new read-through</p><h1>${readsForBook(book.id).length?"Start Reread":"Start Reading"}</h1><p>${esc(book.title)}</p><form id="start-read-form"><div class="form-grid"><div class="field"><label for="read-format">Format</label><select id="read-format" name="format"><option value="print" ${defaultFormat==="print"?"selected":""}>Physical</option><option value="ebook">Ebook</option><option value="audiobook" ${defaultFormat==="audiobook"?"selected":""}>Audiobook</option><option value="other">Other</option></select></div>${field("Start date","start_date",state.data.today,"date",true)}${field("Starting page","starting_page","","number")}${field("Starting percent","starting_percent","","number")}${field("Listening speed","listening_speed",1,"number")}<div class="field span-2"><label for="read-notes">Read-through notes</label><textarea id="read-notes" name="notes" placeholder="Edition, reason for rereading, or anything specific to this read"></textarea></div></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Begin Read-Through</button></div></form>`);
  document.querySelector("#start-read-form").addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.book_id=book.id;data.local_date=state.data.today;try{await api("/api/reads",{method:"POST",body:JSON.stringify(data)});formDialog.close();await refresh();toast("New read-through started");}catch(error){toast(error.message);}});
}

function openProgress(readId) {
  const read=state.data.reads.find((item)=>item.id===readId), book=bookById(read.book_id);
  const audioRuntime=read.audiobook_runtime_seconds_snapshot??book.audiobook_runtime_seconds;
  const audio=read.format==="audiobook"&&audioRuntime?audioBreakdown(audioRuntime,read.progress_percent||0):"";
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">${readLabel(read)}</p><h1>Update Progress</h1><p>${esc(book.title)}</p><form id="progress-form"><div class="form-grid">${read.format!=="audiobook"?field("Current page","page",read.progress_page,"number"):""}${read.format!=="print"?field("Percent complete","percent",read.progress_percent,"number"):""}${read.format==="audiobook"?field("Listening speed","listening_speed",read.listening_speed||1,"number"):""}</div>${audio}<div class="form-actions"><button type="button" class="button danger" id="mark-dnf">DNF This Read</button><button type="button" class="button" id="mark-finished">Finish Read</button><button class="button primary">Save Progress</button></div></form>`);
  const form=document.querySelector("#progress-form");
  form.addEventListener("submit",async(event)=>{event.preventDefault();try{await api(`/api/reads/${read.id}/progress`,{method:"PUT",body:JSON.stringify(Object.fromEntries(new FormData(form)))});formDialog.close();await refresh();toast("Progress updated");}catch(error){toast(error.message);}});
  document.querySelector("#mark-finished").addEventListener("click",()=>{if(confirm(`Finish ${readLabel(read)} today?`))completeRead(read,"finish");});
  document.querySelector("#mark-dnf").addEventListener("click",()=>{if(confirm(`Mark only ${readLabel(read)} as DNF? The underlying book and earlier reads will be kept.`))completeRead(read,"dnf");});
}

function audioBreakdown(runtime,percent) { const elapsed=Math.round(runtime*percent/100);return `<p class="panel" style="margin-top:14px"><strong>${Math.round(percent)}% complete</strong><br>${fmtDuration(elapsed)} content elapsed · ${fmtDuration(runtime-elapsed)} remaining</p>`; }
async function completeRead(read,action){try{if(state.activeTimer?.read_id===read.id)await api(`/api/sessions/${state.activeTimer.id}/stop`,{method:"POST",body:JSON.stringify({ended_at:new Date().toISOString()})});await api(`/api/reads/${read.id}/${action}`,{method:"POST",body:JSON.stringify({local_date:state.data.today,finish_date:state.data.today})});formDialog.close();await refresh();toast(action==="finish"?"Read-through finished":"This read-through was marked DNF; the book remains available");}catch(error){toast(error.message);}}

async function finishReadFromCard(readId){const read=state.data.reads.find((item)=>item.id===readId);if(!read)return;if(!confirm(`Finish ${readLabel(read)} today?`))return;await completeRead(read,"finish");}

function openEditRead(readId) {
  const read=state.data.reads.find((item)=>item.id===readId), book=read&&bookById(read.book_id);
  if(!read||!book)return;
  const audioRuntime=Number(read.audiobook_runtime_seconds_snapshot||0);
  formDialogContent(`<button class="modal-close" data-close aria-label="Close">×</button><p class="eyebrow">${readLabel(read)} · ${esc(book.title)}</p><h1>Edit Read-through</h1><p class="subtle">Changes here affect only this reading record. Book title, author, and series remain under Edit Book.</p><form id="edit-read-form"><div class="form-grid">
    ${field("Start date","start_date",read.start_date,"date",true)}${field("Finish date","finish_date",read.finish_date,"date")}
    <div class="field"><label for="read-state">Status</label><select id="read-state" name="state"><option value="active" ${read.state==="active"?"selected":""}>Reading</option><option value="finished" ${read.state==="finished"?"selected":""}>Finished</option><option value="dnf" ${read.state==="dnf"?"selected":""}>DNF This Read</option></select></div>
    <div class="field"><label for="edit-read-format">Format</label><select id="edit-read-format" name="format"><option value="print" ${read.format==="print"?"selected":""}>Physical</option><option value="ebook" ${read.format==="ebook"?"selected":""}>Ebook</option><option value="audiobook" ${read.format==="audiobook"?"selected":""}>Audiobook</option><option value="other" ${read.format==="other"?"selected":""}>Other</option></select></div>
    ${field("Current page","progress_page",read.progress_page,"number")}${field("Current percent","progress_percent",read.progress_percent,"number")}
    ${field("Listening speed","listening_speed",read.listening_speed||1,"number")}${field("Edition page-count snapshot","page_count_snapshot",read.page_count_snapshot,"number")}
    ${field("Audiobook snapshot hours","snapshot_hours",Math.floor(audioRuntime/3600),"number")}${field("Audiobook snapshot minutes","snapshot_minutes",Math.round(audioRuntime%3600/60),"number")}
    <div class="field span-2"><label for="edit-read-notes">Read-through notes</label><textarea id="edit-read-notes" name="notes">${esc(read.notes||"")}</textarea></div>
  </div><p class="subtle">Changing Finished or DNF back to Reading repairs this same read-through. It does not create a new reread.</p><div class="form-actions"><button type="button" class="button danger" id="delete-read-from-edit">Delete Read-through</button><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save Read-through</button></div></form>`);
  const form=document.querySelector("#edit-read-form");
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
function showNextCheckin(){const item=state.pendingCheckins[0];if(!item)return;let fields=(item.format==="print"||item.format==="other")?field("Where did you finish? Page","page",item.progress_page,"number"):item.format==="ebook"?`${field("Page (optional)","page",item.progress_page,"number")}${field("Progress percent (optional)","percent",item.progress_percent,"number")}`:`${field("Current progress","percent",item.progress_percent,"number")}${field("Listening speed","listening_speed",item.listening_speed||1,"number")}`;document.querySelector("#checkin-dialog-content").innerHTML=`<p class="eyebrow">Yesterday’s Reading</p><h1>${esc(item.title)}</h1><p>You ${item.format==="audiobook"?"listened":"read"} for <strong>${fmtDuration(item.duration_seconds)}</strong> across ${item.session_count} session${item.session_count===1?"":"s"}.</p><form id="checkin-form"><div class="form-grid">${fields}</div><div class="form-actions"><button type="button" class="button" id="checkin-later">Later</button><button class="button primary">Save</button></div></form>`;checkinDialog.showModal();document.querySelector("#checkin-later").addEventListener("click",()=>checkinDialog.close());document.querySelector("#checkin-form").addEventListener("submit",async(event)=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));Object.assign(data,{read_id:item.read_id,session_date:item.session_date});try{await api("/api/checkins",{method:"POST",body:JSON.stringify(data)});state.pendingCheckins.shift();checkinDialog.close();await refresh();if(state.pendingCheckins.length)showNextCheckin();toast("Yesterday’s progress saved");}catch(error){toast(error.message);}});}

function formDialogContent(html){document.querySelector("#form-dialog-content").innerHTML=html;formDialog.showModal();document.querySelectorAll("#form-dialog-content [data-close]").forEach((el)=>el.addEventListener("click",()=>formDialog.close()));}
function showFatal(error){app.innerHTML=`<div class="error-banner"><h2>Opal Shelf couldn’t open</h2><p>${esc(error.message)}</p><p>Check the Worker URL in <code>config.js</code> and your access token in Settings.</p><button class="button" id="retry">Try Again</button></div>`;document.querySelector("#retry").addEventListener("click",()=>refresh({checkins:true}).catch(showFatal));}

document.querySelectorAll("[data-nav]").forEach((button)=>button.addEventListener("click",()=>nav(button.dataset.nav)));
document.querySelector("#add-book-button").addEventListener("click",openAddBook);
[bookDialog,formDialog,checkinDialog].forEach((dialog)=>dialog.addEventListener("click",(event)=>{if(event.target===dialog)dialog.close();}));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh({checkins:true}).catch(showFatal);});
window.addEventListener("focus",()=>refresh({checkins:true}).catch(()=>{}));
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
refresh({checkins:true}).catch(showFatal);
