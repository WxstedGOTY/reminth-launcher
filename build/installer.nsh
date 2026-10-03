; Reminth's additions to the electron-builder installer (it includes
; build/installer.nsh on its own).
;
; Reminth installs for the current user only (%LOCALAPPDATA%\Programs\Reminth),
; so installing and updating never need admin rights and Windows never shows
; its "Do you want to allow this app to make changes?" prompt.
;
; Up to 1.4.1 the installer could put Reminth in C:\Program Files "for all
; users", which needs that prompt on EVERY update. When this installer finds
; such a copy it removes it once (Windows asks one last time; saying No just
; leaves the old copy where it is). The player's data - instances, worlds,
; accounts, settings - lives in %APPDATA%\Reminth, outside both install
; folders, and the old uninstaller is told to keep it (/KEEP_APP_DATA).
!macro customInstall
  ${if} $installMode == "CurrentUser"
    Push $R7
    Push $R8
    ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $R7 != ""
    ${andIf} $R7 != $INSTDIR
    ${andIf} ${FileExists} "$R7\${UNINSTALL_FILENAME}"
      ; Run a copy from outside the folder so it can delete the folder;
      ; _?= makes it work on that folder and lets us wait for it.
      StrCpy $R8 "$PLUGINSDIR\old-allusers-uninstaller.exe"
      CopyFiles /SILENT "$R7\${UNINSTALL_FILENAME}" "$R8"
      ${if} ${FileExists} "$R8"
        ExecShellWait "runas" "$R8" '/allusers /S /KEEP_APP_DATA _?=$R7'
      ${endIf}
      ClearErrors
    ${endIf}
    Pop $R8
    Pop $R7
  ${endIf}
!macroend
