!define GHOSTLINK_INFO_URL "https://github.com/paavalipopov/ghostlink"

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  Var GhostlinkFolderInput
  Var GhostlinkProgressState
  !define MUI_CUSTOMFUNCTION_ABORT GhostlinkProgressClose

  ; Resolve scope before the first visible page, preserving existing installs.
  !macro customInstallMode
    ${If} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    PageEx custom
      PageCallbacks GhostlinkSetupCreate GhostlinkSetupLeave
    PageExEnd

    Function GhostlinkSetupCreate
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "Install Ghostlink" "Share a pointer with a friend."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 20u "Choose a folder, then click Install."
      Pop $0
      ${NSD_CreateLabel} 0 30u 100% 12u "Install location"
      Pop $0
      ${NSD_CreateDirRequest} 0 46u 230u 14u "$INSTDIR"
      Pop $GhostlinkFolderInput
      ${NSD_CreateBrowseButton} 236u 45u 64u 16u "Browse..."
      Pop $0
      ${NSD_OnClick} $0 GhostlinkBrowse
      ${NSD_CreateLink} 0 80u 100% 12u "About Ghostlink on GitHub"
      Pop $0
      ${NSD_OnClick} $0 GhostlinkOpenInfo
      GetDlgItem $0 $HWNDPARENT 1
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
      GetDlgItem $0 $HWNDPARENT 3
      EnableWindow $0 0
      nsDialogs::Show
    FunctionEnd

    Function GhostlinkBrowse
      Pop $0
      ${NSD_GetText} $GhostlinkFolderInput $1
      nsDialogs::SelectFolderDialog "Choose an installation folder" "$1"
      Pop $0
      ${If} $0 != error
        ${NSD_SetText} $GhostlinkFolderInput $0
      ${EndIf}
    FunctionEnd

    Function GhostlinkSetupLeave
      ${NSD_GetText} $GhostlinkFolderInput $1
      ${If} $1 == ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "Choose an installation folder."
        Abort
      ${EndIf}
      System::Call 'shlwapi::PathIsRelativeW(w r1)i.r0'
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a full folder path, such as C:\Apps\Ghostlink."
        Abort
      ${EndIf}
      ; NSIS GetFullPathName requires the parent to exist. Normalize the path
      ; with Win32 so setup can accept and create new folders.
      System::Call 'kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r2, p 0)i.r0'
      ${If} $0 == 0
      ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a valid installation folder."
        Abort
      ${EndIf}
      StrCpy $1 $2
      ; Use a dedicated subfolder for a new destination, while preserving an
      ; existing install path. Uninstall must not remove a shared parent folder.
      ${If} $1 != $INSTDIR
        ${GetFileName} "$1" $0
        ${If} $0 != "${APP_FILENAME}"
          StrCpy $1 "$1\${APP_FILENAME}"
        ${EndIf}
      ${EndIf}
      StrCpy $INSTDIR "$1"
    FunctionEnd

    Function GhostlinkOpenInfo
      Pop $0
      ExecShell "open" "${GHOSTLINK_INFO_URL}"
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE GhostlinkProgressLeave
  !macroend

  ; Keep the stock progress screen as the last visible page.
  !macro customFinishPage
    Function GhostlinkProgressLeave
      IfAbort done

      ; The first leave callback is NSIS advancing after the install section.
      ; Keep the completed progress screen visible until a button is chosen.
      ${If} $GhostlinkProgressState == ""
        StrCpy $GhostlinkProgressState "complete"
        !insertmacro MUI_HEADER_TEXT "Ghostlink is installed" "You're ready to connect."
        GetDlgItem $0 $HWNDPARENT 3
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1
        SendMessage $0 ${WM_SETTEXT} 0 "STR:Start the app"
        EnableWindow $0 1
        GetDlgItem $1 $HWNDPARENT 2
        SendMessage $1 ${WM_SETTEXT} 0 "STR:Close"
        EnableWindow $1 1
        System::Call 'user32::GetSystemMenu(p $HWNDPARENT, i 0)p.r2'
        System::Call 'user32::EnableMenuItem(p r2, i 0xF060, i 0)i'
        SendMessage $HWNDPARENT ${WM_NEXTDLGCTL} $1 1
        Abort
      ${EndIf}

      ${If} $GhostlinkProgressState == "complete"
        HideWindow
        ${If} ${isUpdated}
          StrCpy $1 "--updated"
        ${Else}
          StrCpy $1 ""
        ${EndIf}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      ${EndIf}
      SetAutoClose true
    done:
    FunctionEnd

    Function GhostlinkProgressClose
      ${If} $GhostlinkProgressState == "complete"
        ; Route Close through the successful completion path.
        StrCpy $GhostlinkProgressState "close"
        System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)i'
        Abort
      ${EndIf}
    FunctionEnd
  !macroend
!endif
