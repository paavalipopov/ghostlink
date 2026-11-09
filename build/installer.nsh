!define GHOSTLINK_INFO_URL "https://github.com/paavalipopov/ghostlink"

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  Var GhostlinkFolderInput

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
      ClearErrors
      GetFullPathName $1 "$1"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a valid installation folder."
        Abort
      ${EndIf}
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
  !macroend

  !macro customFinishPage
    Page custom GhostlinkFinishCreate

    Function GhostlinkFinishCreate
      !insertmacro MUI_HEADER_TEXT "Ghostlink is installed" "You're ready to connect."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}
      ${NSD_CreateLabel} 0 0 100% 26u "Open Ghostlink now, or use its shortcut later."
      Pop $0
      ${NSD_CreateButton} 0 48u 85u 18u "Close"
      Pop $0
      ${NSD_OnClick} $0 GhostlinkFinishClose
      ${NSD_CreateButton} 95u 48u 180u 18u "Close and open Ghostlink"
      Pop $0
      ${NSD_OnClick} $0 GhostlinkFinishOpen
      GetDlgItem $0 $HWNDPARENT 1
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $HWNDPARENT 2
      ShowWindow $0 ${SW_HIDE}
      GetDlgItem $0 $HWNDPARENT 3
      ShowWindow $0 ${SW_HIDE}
      nsDialogs::Show
    FunctionEnd

    Function GhostlinkFinishClose
      Pop $0
      SetErrorLevel 0
      Quit
    FunctionEnd

    Function GhostlinkFinishOpen
      Pop $0
      HideWindow
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      SetErrorLevel 0
      Quit
    FunctionEnd
  !macroend
!endif
