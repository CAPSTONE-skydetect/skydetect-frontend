# Local Pi reconnect helper

`piReconnectPlugin` is an opt-in Vite development plugin, not a production
browser-to-SSH implementation. It runs on the computer already hosting the
camera relay. Docker deployments do not acquire this endpoint automatically.

Register the plugin in a local Vite config with an absolute `controllerPath`
pointing at the AI repository's `hardware/raspberry-pi/control.py`, and a trusted
`backendOrigin` pointing at the existing authenticated gateway. Bind Vite to
`127.0.0.1`, use a fixed port, and define
`import.meta.env.VITE_DEVICE_RECONNECT_URL` as `'/local-device/reconnect'`.
Do not expose the helper through a network proxy.

Requests require POST, matching loopback Host/Origin, session CSRF token and
an authenticated `ROLE_OPERATOR`. Only the fixed `relay reconnect` command
is accepted. The command uses the AI checkout's `.env.pi` configuration,
strict host-key verification and pre-existing SSH authentication. It does
not scan the LAN, enroll keys, accept arbitrary command/host inputs, or
configure another computer automatically. Missing configuration/authentication
produces an error rather than a trust bypass.

Reconnect probes SSH and the camera executable and starts the relay if needed.
An SSH probe success alone does not prove that frames are being delivered;
the player must still establish WebRTC/HLS and show advancing video.
