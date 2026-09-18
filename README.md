# Chapter Review Quiz

A free, static quiz-review site for GitHub Pages. Students enter their full name, class, and a packet code to unlock a set of chapter-review questions with a timer. Results (and structured/essay answers for grading) are logged to a Google Sheet automatically.

- **Frontend**: plain HTML/CSS/JS (`index.html`, `css/`, `js/`) — hosted for free on GitHub Pages.
- **Backend**: a Google Apps Script "Web App" — free, no server to maintain.
- **Database**: a Google Sheet — you control it directly (activate packets, set time limits, grade essays).

Correct answers are **never** sent to the browser — only the Google Sheet/Apps Script know them, so a student inspecting the page or network tab can't see the answer key.

---

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like "Chapter Review DB".
2. Open **Extensions > Apps Script**. This creates a script *bound to this specific spreadsheet* — important, so it automatically finds the right sheet without any ID configuration.
3. Delete the default `Code.gs` contents and paste in the full contents of this repo's `apps-script/Code.gs`.
4. In the Apps Script editor toolbar, select the function dropdown, choose **setupSheets**, and click **Run** (▶). The first run will ask you to authorize the script (it's your own script acting on your own sheet — click through the "unverified app" warning, it's expected for personal scripts).
5. Back in the spreadsheet, you should now see 5 tabs: `Config`, `AnswerKeys`, `Results`, `EssayResponses`, `ActiveSessions`, each with a header row. (`setupSheets` only creates tabs/headers that don't exist yet, so it's always safe to re-run after updating `Code.gs` — it won't touch data you've already entered.)

### Import the starter data for Chapter 4
6. Click the `Config` tab. Go to **File > Import > Upload**, upload `setup/config-seed.csv` from this repo, and choose **"Append to current sheet"** (so it adds the row below your existing header, not a new sheet).
7. Click the `AnswerKeys` tab. Same steps with `setup/answerkeys-chapter4-networks.csv` — this contains all 100 answers, points, and essay keywords, so you never have to type them in by hand.

Your `Config` row for chapter 4 looks like this:

| PacketCode | PacketTitle | JSONFile | Active | TimeLimitMinutes | GradingMode | QuestionLimit |
|---|---|---|---|---|---|---|
| NET4-100 | Chapter 4: Networks (100 Questions) | chapter4-networks.json | TRUE | 45 | manual | (blank) |

- **Active**: `TRUE`/`FALSE` — turn a packet on or off for students at any time, just by editing this cell.
- **TimeLimitMinutes**: how long a student gets once they start.
- **GradingMode**: `manual` (default — Section 5 written answers go to `EssayResponses` for you to grade by typing a score), `auto` (a rough keyword-match estimate is scored automatically), or `ai` (each student's own free Gemini API key grades their answers — see "AI-assisted grading" below). You can change this per packet, any time.
- **QuestionLimit**: leave blank/`0` to give every student all 100 questions (default). Set a number (e.g. `20`) to give each student a shorter, randomly-sampled subset instead — see "Limiting questions per session" below.

---

## 2. Deploy the Apps Script as a Web App

1. In the Apps Script editor, click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as**: `Me`. Set **Who has access**: `Anyone`. (Students aren't Google-logged-in, so this has to be public — see the security note at the bottom.)
4. Click **Deploy**, authorize again if asked, then copy the **Web app URL** (it ends in `/exec`).

---

## 3. Configure the frontend

1. Open `js/config.js` in this repo.
2. Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the URL you just copied.

---

## 4. Publish to GitHub Pages

1. Push this folder to a new GitHub repository.
2. Go to the repo's **Settings > Pages**, set **Source** to your default branch (root folder), and save.
3. GitHub gives you a URL like `https://yourusername.github.io/your-repo-name/` — share that with your students.

---

## 5. Try it end-to-end

1. Open the site, enter a name, a class, and the code `NET4-100`.
2. Work through the quiz, or just submit early to test.
3. Check the Google Sheet: a new row should appear in `Results`, and (since `GradingMode` is `manual` by default) 20 rows in `EssayResponses` for the Section 5 answers.
4. Try logging in again with the *same* name/class/code — it should say "already submitted."
5. To grade the essays: open `EssayResponses`, read the `StudentAnswer`/`ModelAnswer` columns, and type a number into `ScoreAwarded`. Watch the matching row in `Results` — its `EssayScore` and `FinalScore` columns update automatically (they're formulas, no re-deploy needed).

---

## Adding a new question packet later

1. Create `packets/chapterX-topic.json` following the same structure as `packets/chapter4-networks.json` (sections of type `mcq`, `truefalse`, `fill`, `short`, or `essay` — no answers in this file).
2. Add one new row to the `Config` tab with a fresh, unique `PacketCode`.
3. Add one `AnswerKeys` row per question for that packet code (same columns: `Type`, `CorrectAnswer`, `Points`, and `Keywords` for essays).
4. Set `Active` to `TRUE` when you want students to be able to use it. You can have several packets active at once — each has its own code.
5. Commit and push — GitHub Pages picks up the new JSON file automatically.

---

## Limiting questions per session

By default a student gets every question in the packet. To hand out a shorter review instead:

1. Open the `Config` tab and put a number in that packet's `QuestionLimit` cell — e.g. `20`.
2. That's it. The next student who enters that packet code gets 20 questions, sampled proportionally across all 5 sections (so a 20-question limit still gives roughly 6 MCQ, 3 True/False, 3 fill-in, 4 scenario, 4 essay, scaled to the section sizes) instead of, say, 20 random MCQs.
3. Each student's specific subset is decided once (the first time they enter their code) and stays fixed for them — refreshing, resuming, or the timer running out won't reshuffle it, and grading only ever counts the questions that student actually saw (so `ObjectiveMax`/`EssayMax` in `Results` will show smaller totals than the full packet, proportional to `QuestionLimit`). Different students get different random subsets from each other.
4. To go back to giving everyone all 100 questions, just clear the `QuestionLimit` cell.

Each assignment is recorded in the new `ActiveSessions` tab (`FullName | Class | PacketCode | SelectedQuestionIds | AssignedAt`) — you generally don't need to touch this, it's just how the script remembers who got which subset.

**If you deployed before this feature existed:** add a `QuestionLimit` header to column G of your `Config` tab, and re-run `setupSheets` once from the Apps Script editor to create the `ActiveSessions` tab.

---

## AI-assisted grading

Set a packet's `GradingMode` to `ai` and its Section 5 (structured/essay) answers get graded by Google's Gemini model — using **each student's own free API key**, never yours. No API billing or key setup on your end at all.

How it works:

1. When a student's packet code validates and that packet's `GradingMode` is `ai`, the site shows them a screen with step-by-step instructions to create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (sign in with any Google account, click "Create API key", copy it, paste it in). This happens once per attempt — the key is **not** saved to their browser or sent anywhere except in their own submit request.
2. When they submit, their key travels once to your Apps Script, which calls Gemini itself (server-side, via `UrlFetchApp`) to grade each essay answer against the model answer already in `AnswerKeys` — the model answer still never reaches the student's browser, same as `manual`/`auto` mode.
3. Each essay row in `EssayResponses` gets a `GradingSource` (`AI`, `Keyword`, or `Manual`) and a short `Feedback` sentence explaining the score, so you can see at a glance what the AI did and override any `ScoreAwarded` you disagree with.
4. If a student's key is invalid, hits a quota limit, or they skip entering one, that question just falls back to `Pending Review` for you to grade manually — nothing is ever left ungraded silently. The result screen tells the student honestly whether they got a full AI score, a partial one, or a pending-review notice.

**If you deployed before this feature existed:** your `EssayResponses` tab still has the old `AutoEstimated` (TRUE/FALSE) header in column J. Rename it to `GradingSource` and add a `Feedback` header in column K — `setupSheets` won't rewrite an existing header row for you.

**Limitations specific to this mode:**
- Grading a packet with many essay questions makes one Gemini call per question, so submission can take a while (tens of seconds) for a long packet — consider pairing `ai` mode with `QuestionLimit` to cap how many essay questions each student gets.
- Free-tier keys commonly hit a transient `503` ("model is experiencing high demand") or `429` (rate limit) under load. Each essay call retries automatically up to 3 times with a short backoff before giving up, which noticeably helps but doesn't eliminate this - if a question still fails after retries, it falls back to "Pending Review" rather than failing the whole submission.
- The exact model used is set once in `Code.gs` (`GEMINI_MODEL`, currently `gemini-3.6-flash`) — Google retires model names over time; if grading suddenly starts failing for everyone, this is the first thing to check (the API's error message names the current replacement model directly).
- The current model "thinks" before answering, which burns extra tokens per call (observed ~70-150 thinking tokens for a one-sentence grading prompt) — on a free-tier key this eats into the per-minute/per-day quota faster than a non-thinking model would, on top of the one-call-per-essay-question cost already mentioned above.

---

## Admin dashboard

`admin.html` (published alongside `index.html` at `https://yourusername.github.io/your-repo-name/admin.html`) gives you a browsable table of every submission instead of opening the Sheet directly — filter by packet, search by name/class, sort by any column, expand a row to read a student's written answers next to the model answer and AI feedback, and type in a score to override it on the spot (writes straight back to `EssayResponses`; the `Results` row updates itself since `EssayScore`/`FinalScore` are live formulas).

**One-time setup:**
1. In the Apps Script editor, click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll to **Script Properties** → **Add script property**.
3. Property: `ADMIN_PASSWORD`. Value: a password of your choosing. Save.
4. Redeploy (**Deploy > Manage deployments** → edit → "New version" → Deploy) so the running script picks up the new `adminResults`/`adminUpdateEssayScore` actions.

That's it — no code, no committing a password anywhere public. Open `admin.html`, enter that password once (it's kept only in `sessionStorage`, so it clears when the browser tab closes — use **Lock** to clear it sooner on a shared computer), and the dashboard loads.

**Note:** the page itself is a public file like any other on GitHub Pages, but it shows no student data until the correct password is entered — the password is checked server-side against Script Properties, never against anything in this repo.

---

## Managing question packets from the admin dashboard

The **Packets** tab in `admin.html` lets you create new packets, add/edit their questions, and generate each packet's join code — all from the browser, with no git commit needed for content changes.

**One-time setup (if you deployed before this feature existed):**
1. In the Apps Script editor, re-run **setupSheets** from the function dropdown — this adds a new `Questions` tab (it won't touch your existing data).
2. Redeploy: **Deploy > Manage deployments** → edit → "New version" → Deploy, so the running script picks up the new `adminListPackets`/`adminGetPacket`/`adminCreatePacket`/`adminSavePacket` actions.

**How it works:**
1. Click **+ New Packet**, type a title, and a unique `PacketCode` is generated for you automatically (e.g. `CHAPTER-5-7F3K`) — copy it from the packet editor to share with students once you're done adding questions.
2. Click **+ Add question** to add one to the flat questions list, then pick its **Type** (Multiple Choice, True/False, Fill in the Blank, Scenario Short Answer, or Essay/Structured) from the dropdown on the card — the fields below it change to match (options + correct answer for MCQ, a TRUE/FALSE choice, an answer + points for fill/short, or a model answer + marks + keywords for essay). You can change a question's type at any time; its answer fields reset to match.
3. Questions don't need to be grouped or entered in any particular order — add them in whatever order you like, mixing types freely. When a student takes the quiz, they're automatically grouped into pages by type (all MCQs together, then True/False, etc.) purely for pagination; this happens automatically and isn't something you manage.
4. Packet settings — Title, Active, Time limit, Grading mode, Question limit — are edited on the same screen and saved together with the questions.
5. New packets are **Active = No** until you're ready — flip it to Yes once the questions are in place.
6. Editing, retyping, or deleting a question only affects future submissions; it never rewrites past students' `Results`/`EssayResponses` rows, and a question keeps its internal ID across edits (including a type change) so in-progress student attempts aren't broken.

**The original `NET4-100` packet (and any other packet with a `JSONFile` set in the `Config` tab) keeps working exactly as before** — its questions live in `packets/*.json` and are edited by committing to the repo, not from the dashboard. The Packets tab still lets you edit that packet's settings (Active/time limit/grading mode/question limit), but shows a note instead of a question editor for it. Packets created via **+ New Packet** always have their `JSONFile` cell blank and are fully dashboard-managed instead.

**Want Chapter 4 editable from the dashboard too?** Run **migrateChapter4Networks** once from the Apps Script editor's function dropdown. It reads `packets/chapter4-networks.json` (embedded in `Code.gs` as `CHAPTER4_NETWORKS_PACKET`) plus your existing `AnswerKeys` rows, copies all 100 questions into the `Questions` sheet, and clears `NET4-100`'s `JSONFile` cell — after that it behaves exactly like a packet created from **+ New Packet**. Check **View > Logs** in the Apps Script editor after running it for a summary. It's a no-op if you run it twice.

---

## How grading works

- **Sections 1-2 (multiple choice, true/false)**: exact match, graded instantly on submit.
- **Sections 3-4 (fill-in-blank, scenario short answers)**: a lenient "loose match" (ignores case/punctuation, allows partial wording) — not perfect, so spot-check unusually low scores occasionally.
- **Section 5 (structured/essay)**: depends on that packet's `GradingMode`:
  - `manual` — answers go to `EssayResponses`, status shows "Pending Review" to the student, and you type in scores whenever you like.
  - `auto` — a rough keyword-overlap estimate is calculated instantly; flagged to the student as an estimate, and you can still overwrite `ScoreAwarded` in `EssayResponses` later.
  - `ai` — graded by Gemini using the student's own key; see "AI-assisted grading" above.

## Known limitations

- The Apps Script Web App URL is public (required, since students don't log into Google). It's fine for low-stakes classroom review, but a technically determined student could forge a request. Don't use this for a formal, high-stakes exam.
- The countdown timer is enforced in the browser (JavaScript), not on a server — same caveat as above.
- One attempt per student per packet is enforced by checking name+class+code against existing `Results` rows — if a student mistypes their name differently between attempts, this check won't catch it.
