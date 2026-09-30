; Prepare the finalized interactive destination before replacing an old install.
; Keep electron-builder's application-subfolder normalization and all lifecycle logic.
!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE EveriaPrepareDestination

  Function EveriaPrepareDestination
    Call instFilesPre
    ClearErrors
    CreateDirectory "$INSTDIR"
    IfErrors destinationFailed destinationReady
    destinationFailed:
      MessageBox MB_OK|MB_ICONSTOP "Everia could not create the selected installation folder:$\r$\n$INSTDIR$\r$\nChoose a writable location and run Setup again."
      SetErrorLevel 2
      Quit
    destinationReady:
  FunctionEnd
!macroend
