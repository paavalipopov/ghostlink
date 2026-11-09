!define GHOSTLINK_INFO_URL "https://github.com/paavalipopov/ghostlink"
!define MUI_FINISHPAGE_LINK "App information on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "${GHOSTLINK_INFO_URL}"

!macro customWelcomePage
  !include nsDialogs.nsh
  Page custom GhostlinkWelcomeCreate

  Function GhostlinkWelcomeCreate
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "Welcome to Ghostlink" "Share a pointer with a friend."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 42u "Setup will install Ghostlink and its uninstaller.$\r$\n$\r$\nOn the next screens, choose who can use the app and where to install it."
    Pop $0
    ${NSD_CreateLabel} 0 52u 100% 28u "A new installation for all users defaults to Program Files and requires administrator permission. Existing installations keep their current folder by default."
    Pop $0
    ${NSD_CreateLink} 0 92u 100% 12u "App information on GitHub"
    Pop $0
    ${NSD_OnClick} $0 GhostlinkOpenInfo
    nsDialogs::Show
  FunctionEnd

  Function GhostlinkOpenInfo
    Pop $0
    ExecShell "open" "${GHOSTLINK_INFO_URL}"
  FunctionEnd
!macroend
