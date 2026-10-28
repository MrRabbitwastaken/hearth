# Hearth: a warm little work assistant

A Windows desktop app for daily tasks, projects, a calendar, notebooks, screen breaks and focus time.

## Installing

Grab the latest files from the **Releases** page on GitHub. Every push to `main` builds them automatically.

- **Hearth-Setup-x.y.z.exe**: the normal installer.
- **Hearth-Portable-x.y.z.exe**: the portable version. Copy it to a USB stick (or any folder) and run it from there. It keeps everything in a **Hearth Data** folder beside it, so your tasks, notes and pictures travel with you. It doesn't install anything or start with Windows, and on quit it removes the temporary Start-menu shortcut it uses for notifications. To move your existing data onto the stick, use Settings → Export in the installed copy, then Settings → Import in the portable one. Pictures are included in the backup.

### Building it yourself

**Make the installer once:** double-click **`Make-Installer.bat`**. You don't need to install anything first. If Node.js isn't on the PC, the script downloads a private copy into a `.tools` folder, used only for building. After a few minutes it opens `dist\` with **`Hearth-Setup-1.3.0.exe`**.

**Install:** double-click `Hearth-Setup-1.3.0.exe`. A setup wizard lets you choose just-me or all users and the install folder. It creates Start menu and desktop shortcuts, launches Hearth when it finishes, and adds an uninstaller in Windows *Apps*.

- **Silent install** (e.g. NinjaOne): `Hearth-Setup-1.3.0.exe /S`. Add `/allusers` for a machine-wide install.
- The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC" the first time. Click **More info → Run anyway**. Silent installs aren't affected.
- Optional: if this folder is pushed to GitHub, `.github/workflows/build-installer.yml` builds the installer automatically on every push.
- `run-dev.bat` runs Hearth straight from the source folder, for trying changes.

Your data is kept when you install a newer version over the top.

## What's in it

**Today**: daily tasks with **Tomorrow →** buttons and *Move all to tomorrow*. *Carried over* holds yesterday's leftovers. Click any task for its details. Drag the ⋮⋮ handle to reorder, drop onto *Tomorrow*, or drop onto a project in the side panel.

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
- An hourly screen-break clock that resets when you lock the PC or step away.
- Water nudges with a glass tracker, and posture checks.
- A *good-day score* (tasks, focus, breaks and water) with a streak. Weekends don't break the streak.

**Notebooks**: pages that turn (click any line on a page to start writing there), pencil handwriting, sticky notes you can drag about, pencil and highlighter, pasted images and links, highlight text → task, ribbons, journal, search and PDF export.
- **Templates**: meeting, 1:1, incident report, change request, project kick-off, stand-up and checklist. You can also save any page as your own template.
- **Pictures** are taped onto the page. Drag them anywhere, pull the corner to resize, double-click to view full size.
- **Organise the shelf**: right-click a page for Rename, Duplicate, Move up/down, Add to chapter / New chapter…, Move to notebook, Ribbon, Save as template, Export, and Delete. Chapters work like sub-folders: they collapse, and you can right-click one to rename, add a page, reorder or remove it. You can also drag pages around the shelf, into chapters or into other notebooks. Right-click a notebook to rename it, add pages or chapters, export or delete.
- **Tools** (next to *Sticky*): tables (Tab moves between cells), checklists, shapes and arrows for circling or pointing at things (line, arrow, double arrow, elbow, rectangle, ellipse, parallelogram, triangle, diamond; hold Shift to keep them straight), videos from a YouTube link or a file on your PC, **password-locked stickies** (encrypted, and the password is never stored, so don't forget it), date stamps and dividers.
- The **expand** button in the toolbar hides the main menu and the shelf for a full-width page. Click it again to bring them back.
- **Checklists** tick like real boxes. Type `[] ` at the start of a line or use the checklist button.

**Projects**: click the expand arrow on a project to see every task with its tick box, add tasks and set the next action right there. Hearth remembers which projects you left expanded. *Expand all / Simplify all* switches them all at once.

**Recurring routines**: click a routine to open it and add notes, a priority, steps (these become subtasks), the time, the days and the project. Each task it creates carries these with it. *Add one to today now* creates one straight away.

**Plus**: Waiting on, snippets & links, a weekly review with a copyable summary, morning brief, end-of-day wrap-up, and quick capture with **Ctrl+Alt+Space** (Tab switches between task and sticky note).

**Make it yours (Settings)**:
- Show, hide or reorder sidebar pages, or shrink the sidebar to icons only.
- Daylight or Evening theme.
- **Seasonal themes** (Auto, Autumn, Winter, Spring, Summer) with their own colours (spring greens, summer blues). Drifting leaves, snow, petals or sun motes are optional and off by default.
- **Sound effects** (pencil ticks, page rustles, sticky pats, chimes, a soft break bell), with volume and mute (the speaker icon by the logo).
- Calendar hours, wellbeing intervals and smart-add options.

**Shortcuts**: **N** new task · **Ctrl+1…9** switch pages · **Ctrl+\\** compact menu (icons only) · **Ctrl+Shift+\\** hide the notebook shelf · **Alt+←/→** turn notebook pages · **Esc** close panels.

## Your data

Stored locally in `%APPDATA%\Hearth\hearth-data.json`. A dated backup is kept each day (the last 14), and pasted images are saved in `%APPDATA%\Hearth\images`. Settings → *Export / Import* gives you manual backups.

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
