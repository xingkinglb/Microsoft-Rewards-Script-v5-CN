' Launch manager\scheduled-run.js for the Windows scheduled task.
'
' Window visibility comes from manager\console.flag, a one-character file
' the manager keeps in sync with settings.json:
'   "1" or missing -> visible console with live progress (default)
'   "0"            -> hidden, log file only
'
' Deliberately tiny: no JSON parsing here. wscript reads .vbs as ANSI unless
' it has a BOM, so this file stays ASCII-only and the logic stays trivial.

Option Explicit

Dim sh, fso, root, nodeExe, runner, flagPath, cmd, hidden

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = root & "\runtime\node\node.exe"
runner = root & "\manager\scheduled-run.js"
flagPath = root & "\manager\console.flag"

If Not fso.FileExists(nodeExe) Then WScript.Quit 1
If Not fso.FileExists(runner) Then WScript.Quit 1

sh.CurrentDirectory = root
cmd = """" & nodeExe & """ """ & runner & """"

hidden = False
If fso.FileExists(flagPath) Then
    Dim handle, value
    Set handle = fso.OpenTextFile(flagPath, 1)
    value = Trim(handle.ReadLine())
    handle.Close
    If value = "0" Then hidden = True
End If

If hidden Then
    sh.Run cmd, 0, False
Else
    sh.Run cmd & " --console", 1, False
End If
