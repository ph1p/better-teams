# Teams Calm

A calmer, Slack-like client that runs **inside the new Microsoft Teams** desktop
app on macOS. It is a React overlay above Teams: same login, same chats, read
and written through Teams' own backend. Teams keeps running underneath, so
calls, meetings and files still work natively. Toggle with **Option+Cmd+T**.

## Install

```sh
./install.sh
```

Needs Node and the new Teams in `/Applications`. Installs dependencies, puts a
`teams-calm` launcher in `~/.local/bin`, builds the overlay, patches Teams
(asks for your password) and relaunches it.

After a **Teams update** the patch is gone — run `teams-calm` again.

## Use

```sh
teams-calm          # build, patch if needed, relaunch Teams
teams-calm status   # patched? debug port open?
teams-calm off      # restore original Teams and relaunch it
```

## Develop

```sh
teams-calm dev      # or: cd app && npm run dev
```

Relaunches Teams with a DevTools port, runs `vite build --watch` and re-injects
the overlay into every Teams window on each save (~1s, UI state resets).
Ctrl-C relaunches Teams without the port. Run `teams-calm` afterwards to bake
your changes into the patch.

Code lives in `app/src` (entry: `mount.tsx`). Type-check with
`cd app && npm run typecheck`.

### Mock mode (no Teams)

```sh
cd app && npm run mock    # http://localhost:5199
```

Runs the overlay in a normal browser on a Vite dev server with hot reload,
backed by fictional people and chats. The Teams-facing modules (`teamsData`,
`send`, `services/{chat,typing,presence}`) are swapped at build time for
stand-ins in `app/src/mock/` that keep state in memory: sending, editing,
reactions, read state and paging work, colleagues "type" and reply, and new
messages trickle in. Calls and meetings only log to the console. Reload to
reset. `src/mock/parity.ts` fails the type-check if a mock drifts from the
real module's exports.

## How it works

Teams ships local JS (`Contents/Resources/client-bindings/bundle.js`) that it
runs in a hidden 1×1 host page; every visible window is `window.open`ed from
there. `teams-calm` appends the overlay to that file (between
`/*teams-calm:begin*/` markers, built by `build-host-patch.mjs`). The visible
windows enforce Trusted Types, so no script can be injected into them; instead
the host page runs the overlay inside `with (childWindow) { … }`, so `document`,
`fetch`, timers etc. resolve to the child window.

## Security & caveats

- **Patching breaks the app's code-signature seal** (`codesign --verify`
  fails). Teams still launches and signs in. `teams-calm off` restores the
  exact original bytes and the signature verifies again.
- **Dev mode opens debug port 9222.** While it runs, any local process can
  read and control your signed-in Teams session. Normal use has no port.
- Microsoft's terms don't sanction modifying the client; this is a personal,
  local-only tweak. On a managed/work device, check your IT policy first.
- macOS only; tested against new Teams 26289.x (WebView2).

## Uninstall

```sh
./uninstall.sh      # restore Teams, relaunch it, remove the launcher
```
