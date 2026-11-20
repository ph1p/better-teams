# Teams Calm

A calmer, Slack-like client that runs **inside the new Microsoft Teams** desktop
app on macOS. It is a React overlay above Teams: same login, same chats, read
and written through Teams' own backend. Teams keeps running underneath, so
calls, meetings and files still work natively. Toggle with **Option+Cmd+T**.

> Teams Calm is an independent project. It is not affiliated with, endorsed by
> or supported by Microsoft. "Microsoft Teams" is a trademark of Microsoft.

## Requirements

- macOS with the **new** Microsoft Teams in `/Applications` (tested on 26289.x)
- Node.js 20+ and pnpm (`corepack enable pnpm`; `teams-calm dev` needs Node 22+)
- An administrator password: the Teams app bundle is owned by root

Check everything with `./teams-calm doctor`.

## Install

```sh
git clone <this repo> teams-calm && cd teams-calm
./install.sh               # or ./install.sh --no-start
```

The installer checks the requirements, installs dependencies with `pnpm install`,
links a `teams-calm` launcher into `~/.local/bin`, builds the overlay, patches
Teams and relaunches it. It is safe to re-run, e.g. after `git pull`.

After a **Teams update** the patch is gone: run `teams-calm` again.

## Use

```sh
teams-calm            # build, patch if needed, relaunch Teams
teams-calm status     # Teams version, patch state, debug port
teams-calm off        # restore original Teams (relaunch if it was running)
teams-calm doctor     # check requirements
teams-calm help       # all commands
```

## Uninstall

```sh
./uninstall.sh             # or: teams-calm uninstall
./uninstall.sh --purge     # also delete node_modules and build output
```

Restores Teams' original bytes (the code signature verifies again), relaunches
Teams if it was running and removes the launcher. The project folder stays;
delete it to remove everything.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Overlay gone after a Teams update | Run `teams-calm`. |
| Teams misbehaves or won't start | `teams-calm off`, then report the Teams version from `teams-calm status`. |
| `client-bindings/bundle.js missing` | This Teams build loads differently and is not supported. |
| `teams-calm: command not found` | Add `~/.local/bin` to `PATH` (the installer prints the line). |
| Teams did not quit | Quit it from the menu bar, then run the command again. |

## Develop

```sh
teams-calm dev      # or: cd app && pnpm run dev
```

Relaunches Teams with a DevTools port, runs `vite build --watch` and re-injects
the overlay into every Teams window on each save (~1s, UI state resets).
Ctrl-C relaunches Teams without the port. Run `teams-calm` afterwards to bake
your changes into the patch.

Type-check with `cd app && pnpm run typecheck`.

### Mock mode (no Teams)

```sh
cd app && pnpm run mock    # http://localhost:5199
```

Runs the overlay in a normal browser on a Vite dev server with hot reload,
backed by fictional people and chats. The Teams-facing modules (`teamsData`,
`send`, `services/{chat,typing,presence}`) are swapped at build time for
stand-ins in `app/src/mock/` that keep state in memory: sending, editing,
reactions, read state and paging work, colleagues "type" and reply, and new
messages trickle in. Calls and meetings only log to the console. Reload to
reset. `src/mock/parity.ts` fails the type-check if a mock drifts from the
real module's exports.

### Layout

```
teams-calm                 launcher (start, dev, patch, off, status, uninstall…)
install.sh / uninstall.sh  thin wrappers around the launcher
scripts/
  build-host-patch.mjs     wraps the app bundle into the bundle.js payload
  dev.mjs                  CDP hot-reload for `teams-calm dev`
  presence-bridge.mjs      presence events in dev mode
app/src/
  mount.tsx                entry: mounts the overlay into a Teams window
  teamsData.ts, data/      read/write layer over Teams' IndexedDB + chat service
  send.ts, services/       sending, typing, presence, auth, CDL
  ui/                      React components
  mock/                    browser-only stand-ins for mock mode
docs/                      notes on the Teams APIs used
```

## How it works

Teams ships local JS (`Contents/Resources/client-bindings/bundle.js`) that it
runs in a hidden 1×1 host page; every visible window is `window.open`ed from
there. `teams-calm` appends the overlay to that file (between
`/*teams-calm:begin*/` markers, built by `scripts/build-host-patch.mjs`). The
visible windows enforce Trusted Types, so no script can be injected into them;
instead the host page runs the overlay inside `with (childWindow) { … }`, so
`document`, `fetch`, timers etc. resolve to the child window.

## Security & caveats

- **Patching breaks the app's code-signature seal** (`codesign --verify`
  fails). Teams still launches and signs in. `teams-calm off` restores the
  exact original bytes and the signature verifies again.
- **Dev mode opens debug port 9222.** While it runs, any local process can
  read and control your signed-in Teams session. Normal use has no port.
- No data leaves your machine except through Teams' own endpoints, with
  Teams' own tokens.
- Microsoft's terms don't sanction modifying the client; this is a personal,
  local-only tweak. On a managed/work device, check your IT policy first.
- macOS only.

## License

[MIT](LICENSE)
