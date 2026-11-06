# Ghostlink

A ghost pointer for two people playing the same point-and-click game on two Windows PCs. Each of you runs your own copy of the game. You see your friend's cursor, and a ring when they click. The ring does not click your game.

You do not need Node, npm, or the source code to play.

## Put this on your computer

`ghostlink-source.zip` in this project is the source only. It is under 1 MB.

1. On GitHub, create a new empty repository named `ghostlink`. Do not add a README or a gitignore.
2. Download `ghostlink-source.zip` and unzip it, for example to `C:\Users\paava\ghostlink`.
3. In PowerShell, in that folder:

```powershell
git init
git add .
git commit -m "Import Ghostlink"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/ghostlink.git
git push -u origin main
```

4. In Cursor, start a new project from that GitHub repository.

This session is not logged into GitHub, so the push has to happen on your PC. After Node.js 22 is installed, `npm install` and `npm run dev` work in that folder.

## Play

1. Get `release/Ghostlink-0.1.0-windows.zip`.
2. Unzip the whole folder. Leave the files together.
3. Double-click `Ghostlink.exe`.
4. If Windows says it protected your PC, click **More info**, then **Run anyway**. Windows asks because the app is not signed with a paid certificate.
5. Send that same zip to your friend. They unzip it and open `Ghostlink.exe` too.

Then, on both PCs:

1. Type your name.
2. One person clicks **New code**, then **Copy**, and pastes it into any chat. The other person types that exact code.
3. Both click **Connect** and wait until it says you are connected.
4. Start the game in a window. Exclusive fullscreen hides the cursor.
5. Put the mouse over the game and click **The window under my mouse**. Do this on both computers, on the same game picture.
6. Their cursor appears on your screen. A click draws a ring.

`HOWTO.txt` in the unzipped folder says the same thing.

## Only if you are editing the program

The commands `npm install` and `npm run dev` are for that. They fail in a normal PowerShell window because that window is not the project folder, and Node.js is a separate install. Playing does not use them.

On a machine with Node.js 22, in this project folder:

```bash
npm install
npm run dev
```

`npm run build:win` rebuilds the zip in `dist/`.

## If Connect never finds them

Leave the backup fields empty until that happens. Open **If you cannot connect** in the app.

- The status stays on “looking”: the public introduction relays are blocked. Run `node scripts/relay.mjs` on a machine you both can reach, and put that `ws://` or `wss://` address in **My signaling relay**. Both players set the same address.
- It says the direct path is blocked: run a TURN server such as coturn and fill in the TURN fields on both computers.

## Limits

Windows has one real cursor. Ghostlink draws the second one. It does not move your mouse and it does not click the other copy of the game.

The cursor lines up when both outlines cover the same picture. Different resolutions are fine. A title bar in the outline puts the cursor in the wrong place: mark the two corners of the picture itself.

This is for point-and-click timing, not fast action games.
