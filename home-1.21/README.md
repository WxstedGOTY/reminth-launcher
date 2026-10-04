# Reminth home screen for Minecraft 1.20.1 and 1.21.x

Same mod as `../home` (read its README), built for the older, obfuscated versions with Mojang's names
(`fabric-loom-remap`). The shared, version-independent code is `../home/src/common/java`, and the pictures and
icons are `../home/src/main/resources`; only the few calls that differ live in `compat/<family>/`:

| family | Minecraft | what differs |
|---|---|---|
| P | 1.20.1 | `onPress()`, screens in `gui.screens`, `ConnectScreen` without transfer state, Java 17 |
| Q | 1.21 - 1.21.1 | `gui.screens.options` package, `ConnectScreen` with transfer state |
| R | 1.21.4 - 1.21.5 | texture drawing through `RenderType::guiTextured` |
| S | 1.21.6 - 1.21.8 | texture drawing through `RenderPipelines.GUI_TEXTURED` |
| T | 1.21.9 - 1.21.10 | `onPress(InputWithModifiers)` |
| U | 1.21.11 | `renderContents`, `Identifier` |

The `PanoramaPitchMixin` target needs the full method signature (the remapper cannot resolve it without), which
is why each family has its own copy. 1.21.2 and 1.21.3 are not built (neither is ReminthHUD).

```
cd home-1.21
powershell -File build-all.ps1      (leaves build-all/reminthhome-1.0.0+<version>.jar for each row)
```

Copy the jars to the launcher's `assets/mods/`; Reminth reads each jar's Minecraft range.
