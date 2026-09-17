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
5. Back in the spreadsheet, you should now see 4 tabs: `Config`, `AnswerKeys`, `Results`, `EssayResponses`, each with a header row.

### Import the starter data for Chapter 4
6. Click the `Config` tab. Go to **File > Import > Upload**, upload `setup/config-seed.csv` from this repo, and choose **"Append to current sheet"** (so it adds the row below your existing header, not a new sheet).
7. Click the `AnswerKeys` tab. Same steps with `setup/answerkeys-chapter4-networks.csv` — this contains all 100 answers, points, and essay keywords, so you never have to type them in by hand.

Your `Config` row for chapter 4 looks like this:

| PacketCode | PacketTitle | JSONFile | Active | TimeLimitMinutes | GradingMode |
|---|---|---|---|---|---|
| NET4-100 | Chapter 4: Networks (100 Questions) | chapter4-networks.json | TRUE | 45 | manual |

- **Active**: `TRUE`/`FALSE` — turn a packet on or off for students at any time, just by editing this cell.
- **TimeLimitMinutes**: how long a student gets once they start.
- **GradingMode**: `manual` (default — Section 5 written answers go to `EssayResponses` for you to grade by typing a score) or `auto` (a rough keyword-match estimate is scored automatically). You can change this per packet, any time.

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

## How grading works

- **Sections 1-2 (multiple choice, true/false)**: exact match, graded instantly on submit.
- **Sections 3-4 (fill-in-blank, scenario short answers)**: a lenient "loose match" (ignores case/punctuation, allows partial wording) — not perfect, so spot-check unusually low scores occasionally.
- **Section 5 (structured/essay)**: depends on that packet's `GradingMode`:
  - `manual` — answers go to `EssayResponses`, status shows "Pending Review" to the student, and you type in scores whenever you like.
  - `auto` — a rough keyword-overlap estimate is calculated instantly; flagged to the student as an estimate, and you can still overwrite `ScoreAwarded` in `EssayResponses` later.

## Known limitations

- The Apps Script Web App URL is public (required, since students don't log into Google). It's fine for low-stakes classroom review, but a technically determined student could forge a request. Don't use this for a formal, high-stakes exam.
- The countdown timer is enforced in the browser (JavaScript), not on a server — same caveat as above.
- One attempt per student per packet is enforced by checking name+class+code against existing `Results` rows — if a student mistypes their name differently between attempts, this check won't catch it.
