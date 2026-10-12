# Renders demo.gif with https://github.com/charmbracelet/vhs (see .github/workflows/bench.yml).
Output demo.gif

Set Shell bash
Set FontSize 22
Set Width 1000
Set Height 360
Set Padding 24
Set TypingSpeed 50ms

# A stand-in dev server left running on port 3000; the subshell keeps job messages out of the recording.
Hide
Type "mkdir -p /tmp/my-app && cd /tmp/my-app && echo 'require(`http`).createServer().listen(3000)' > server.js && (node server.js &) && sleep 1 && clear"
Enter
Sleep 2s
Show

Type "kill-port-safe who 3000"
Sleep 400ms
Enter
Sleep 2.5s
Type "kill-port-safe 3000"
Sleep 400ms
Enter
Sleep 2.5s
Type "kill-port-safe 3000"
Sleep 400ms
Enter
Sleep 3s
