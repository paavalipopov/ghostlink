# Ghostlink

<img src="docs/logo.png" alt="Ghostlink" width="96">

Ghostlink shows the other person's pointer on your screen when you both use the same secret. When they click, that pointer blinks, then returns to its color. Your own pointer stays where you put it.

![Ghostlink control panel](docs/panel.png)

## Connect

1. Choose a username and a secret (or pick random with dice), share the secret with the other person.
3. Click **Connect** and app will try to etablish connection with the other person for a minute.
3. When the other person is there, the indicator turns green and the button says Connected.


## Setting the shared area

Other people pointer's appears only inside the rectangle on your screen. This rectangle is also the only place that shares your pointer; if you move your mouse outside that frame, the other person can't see it.

- Click **Full Screen** to use the whole display.
- Click **Drag frame**, then drag a rectangle.
- Click **Pick window**, move the pointer over a window, and wait through the countdown. The rectangle becomes that window.


## Build

On Windows, from this folder:

```
npm install
npm run build:win
```

That writes `dist/Ghostlink-x.x.x-windows.zip`. Unzip it and open `Ghostlink.exe`. 

`npm run dev` runs Ghostlink from source.
