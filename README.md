# Hearth: a warm little work assistant

A Windows desktop app for daily tasks, projects, a calendar, notebooks, screen breaks and focus time.

## Installing

Grab the latest files from the **Releases** page on GitHub. Every push to `main` builds them automatically.

- **Hearth-Setup-x.y.z.exe**: the normal installer.
- **Hearth-Portable-x.y.z.exe**: the portable version. Copy it to a USB stick (or any folder) and run it from there. It keeps everything in a **Hearth Data** folder beside it, so your tasks, notes and pictures travel with you. It doesn't install anything or start with Windows, and on quit it removes the temporary Start-menu shortcut it uses for notifications. To move your existing data onto the stick, use Settings → Export in the installed copy, then Settings → Import in the portable one. Pictures are included in the backup.

### Building it yourself

**Make the installer once:** double-click **`Make-Installer.bat`**. You don't need to install anything first. If Node.js isn't on the PC, the script downloads a private copy into a `.tools` folder, used only for building. After a few minutes it opens `dist\` with **`Hearth-Setup-1.8.0.exe`**.

**Install:** double-click `Hearth-Setup-1.8.0.exe`. A setup wizard lets you choose just-me or all users and the install folder. It creates Start menu and desktop shortcuts, launches Hearth when it finishes, and adds an uninstaller in Windows *Apps*.

- **Silent install** (e.g. NinjaOne): `Hearth-Setup-1.8.0.exe /S`. Add `/allusers` for a machine-wide install.
- The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" the first time. Click **More info → Run anyway**. Silent installs aren't affected.
- Optional: if this folder is pushed to GitHub, `.github/workflows/build-installer.yml` builds the installer automatically on every push.
- `run-dev.bat` runs Hearth straight from the source folder, for trying changes.

Your data is kept when you install a newer version over the top.

## What's in it

**Today**: daily tasks with **Tomorrow →** buttons and *Move all to tomorrow*. *Carried over* holds yesterday's leftovers. Click any task for its details. Drag the ⋮⋮ handle to reorder, drop onto *Tomorrow*, or drop onto a project in the side panel.

**Search everything**: press **Ctrl+K** anywhere (or click *Search* at the top of the menu). One box finds tasks, projects, notebook pages (including the text inside them and stickies), snippets, waiting-on items, routines, settings and handy actions. **Tab** switches between All / Tasks / Projects / Notes / Snippets. Enter opens it: a snippet is copied straight away, and a note opens with your words highlighted.

**Holidays & leave** (Settings): UK bank holidays come from GOV.UK (England & Wales, Scotland or Northern Ireland), with a built-in list if you're offline. Book annual leave (full or half days, with a note) in Settings, or right-click a day on the Calendar. Set your yearly allowance to see days booked and left; weekends and bank holidays aren't counted. Days off show on the calendar, pause weekday/weekly routines, keep your streak safe, skip the morning brief and wrap-up, and show in *Time left today*. "First/last working day" routines skip bank holidays.

**Time per project**: focus sessions count automatically, and you can log other time (meetings, calls) with **+15m / +30m / +1h / Log…** on an expanded project or in its details, where the history is too. *Weekly review → Time by project* splits focus and hand-logged time, and **CSV** saves the week for timesheets.

**Smart quick-add**: type naturally, e.g. `Chase Dell fri 2pm #vendors !1 @win11`. A live preview shows what Hearth understood. It knows *today, tomorrow, tonight, mon–fri, next tue, in 3 days, 25/11, 3rd dec, 2pm, 14:30, at 9*, plus `#labels`, `!1`–`!3` priority and `@project`.

**Task details**: subtasks with a progress bar, P1–P3 priority, labels (click one to filter), date, time and duration, a reminder (at the time, or 5/15/30/60 min before), project and notes.

**Calendar**:
- *Month*: every task on its date. Drag tasks between days. Click a day to see and add to it. Project due dates and upcoming recurring tasks also appear.
- *Week* and *Day*: time blocking. Drag tasks from "all day" into hour slots, drag blocks to move them, pull the bottom edge to change their length, and click an empty slot to add a task there. A red line marks the current time.

**Focus**: 25/50/90-minute timers or ▶ on any task.
- Soundscapes (rain, café, fireside, waves) stream from YouTube by default and fall back to built-in sounds when you're offline. Right-click a sound to switch it to the built-in version, use a different link, or reset it.
- **Add your own sound**: the **+ Add** tile takes any YouTube link (lofi beats, a live stream, a playlist) with a name and icon. Right-click it to edit or remove it.
- The *focus shield* holds break, water and posture reminders until you finish.
- An optional, experimental *Windows do-not-disturb* silences toast notifications during focus.

**Wellbeing**:
- An hourly screen-break clock that resets when you lock the PC or step away. Click the ↺ in the middle of the clock (bottom left, or on the Screen break card) to reset it any time.
- Water nudges with a glass tracker, and posture checks.
- A *good-day score* (tasks, focus, breaks and water) with a streak. Weekends don't break the streak.

**Notebooks**: pages that turn (click any line on a page to start writing there), pencil handwriting, sticky notes you can drag about, pencil and highlighter, pasted images and links, highlight text → task, ribbons, journal, search and PDF export.
- **Switch book or page from the top bar**: click the notebook name above the page for a list of your notebooks, or the page name for that notebook's pages (and its inside cover). Handy when the shelf is hidden.
- **Book or Simple**: a new notebook asks which style you want. *Book* has pages that turn, handwriting and lined paper. *Simple* is full width with a plain font (Calibri) and the page date and time under the title, like OneNote. You can switch on the inside cover.
- **Fonts**: the **Font** button in the notebook toolbar changes the font across every notebook. *Automatic* means handwriting in books and Calibri in simple notebooks. Highlight some text and click **Font** to give just that text its own font, which is handy for PowerShell lines in Consolas.
- **Templates**: meeting, 1:1, incident report, change request, project kick-off, stand-up and checklist. You can also save any page as your own template.
- **Pictures** are taped onto the page. Drag them anywhere, pull the corner to resize, double-click to view full size.
- **Organise the shelf**: right-click a page for Rename, Duplicate, Move up/down, Add to chapter / New chapter…, Move to notebook, Ribbon, Save as template, Export, and Delete. Chapters work like sub-folders: they collapse, and you can right-click one to rename, add a page, reorder or remove it. You can also drag pages around the shelf, into chapters or into other notebooks. Right-click a notebook to rename it, add pages or chapters, export or delete.
- **Tools** (next to *Sticky*): tables (Tab moves between cells), checklists, shapes and arrows for circling or pointing at things (line, arrow, double arrow, elbow, rectangle, ellipse, parallelogram, triangle, diamond; hold Shift to keep them straight), videos from a YouTube link or a file on your PC, **password-locked stickies** (encrypted, and the password is never stored, so don't forget it), date stamps and dividers.
- The **expand** button in the toolbar hides the main menu and the shelf for a full-width page. Click it again to bring them back.
- **Checklists** tick like real boxes. Type `[] ` at the start of a line or use the checklist button.

**Projects**: click the expand arrow on a project to see every task with its tick box, add tasks, set the next action and keep **notes** right there (they save as you type and are the same notes as in *Details*). Hearth remembers which projects you left expanded. *Expand all / Simplify all* switches them all at once.

**Recurring routines**: monthly ones can run on a set day (e.g. the 1st), the **first working day** or the **last working day** of the month (Mon–Fri). Click a routine to open it and add notes, a priority, steps (these become subtasks), the time, the days and the project. Each task it creates carries these with it. *Add one to today now* creates one straight away.

**Plus**: Waiting on, snippets & links, a weekly review with a copyable summary, morning brief, end-of-day wrap-up, and quick capture with **Ctrl+Alt+Space** (Tab switches between task and sticky note).

**Make it yours (Settings)**:
- **Spell check** (on by default, English UK): misspelt words get a red squiggle in notes, stickies, tasks and project notes. Right-click one for suggestions or *Add to dictionary*. Right-click in any text box also gives Cut, Copy, Paste and Select all. Switch it off or change the dictionary (UK, US, Australia, Canada) under *You & appearance*.
- **Widgets**: right-click any card down the side of Today to move it up or down, or hide it. Settings → *Today widgets* has the full list with arrows and on/off switches. Turn on *Show widgets on other pages* to put the same column on Projects, Notebooks, Calendar and the rest, page by page.
  - **Time left today**: a bar counting down your working day. Set your hours in Settings → *Work hours*, including a **two-week rotation** (e.g. 8:00–4:30 one week, 9:30–6:00 the next) and which days you work. Pick which week this is and it swaps every Monday.
  - **Weather**: type your town once. It shows today's forecast, the next few hours and a nudge when rain is coming (free Open-Meteo service, no account needed).
  - **Deadlines**: projects due in the next two weeks, overdue ones in red.
  - **Ribbons**: every notebook page with a ribbon, one click to jump there.
  - **Pinned snippets**: pin snippets or links (📌 on the Snippets page) for one-click Copy/Open.
- Show, hide or reorder sidebar pages, or shrink the sidebar to icons only.
- Daylight or Evening theme.
- **Seasonal themes** (Auto, Autumn, Winter, Spring, Summer) with their own colours (spring greens, summer blues). Drifting leaves, snow, petals or sun motes are optional and off by default.
- **Sound effects** (pencil ticks, page rustles, sticky pats, chimes, a soft break bell), with volume and mute (the speaker icon by the logo).
- Calendar hours, wellbeing intervals and smart-add options.

**Shortcuts**: **N** new task · **Ctrl+1…9** switch pages · **Ctrl+\\** compact menu (icons only) · **Ctrl+Shift+\\** hide the notebook shelf · **Alt+←/→** turn notebook pages · **Esc** close panels.

## Your data

By default it's stored in `%APPDATA%\Hearth\hearth-data.json`, with pictures and videos in folders beside it and a dated backup each day (the last 14).

**Choose where it lives**: Settings → *Your data* → **Change folder…** lets you pick any folder, e.g. **OneDrive**. Hearth makes a `Hearth` folder there and moves your data, pictures and backups into it. You get a cloud backup and the same data on another PC (install Hearth there and point it at the same folder). If the folder already holds Hearth data, you choose whether to use it or replace it. *Use this PC only* moves it back.
- Best used on one PC at a time. Hearth warns you if it looks open on another PC, picks up changes made elsewhere automatically, and if both change at once it keeps yours and saves the other version beside it.
- Settings → *Export / Import* still gives you manual backups.

## Project layout

```
src/main.js            window, tray, break clock, hotkey, notifications, do-not-disturb, data file
src/preload.js         safe bridge between window and system
src/renderer/          UI: app.js (core), tasks.js (smart add, task drawer, drag & drop),
                       calendar.js, notes.js, sound.js, seasons.js, *.css
src/shared/inbox.js    quick-note → Inbox notebook
build/                 icons and installer artwork
Make-Installer.bat     one-click installer builder
```
