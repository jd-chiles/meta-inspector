# Browser test media

These inputs are synthetic and exist only for deterministic local browser and
server tests. They do not depict a property, tenant, or real inspection.

- `synthetic-h264-test-pattern.mp4` is the short H.264 color-bar test clip used
  for upload and timestamped-frame tests.
- `synthetic-h264-test-pattern.mov` is the same video packet stream copied into
  a QuickTime container with system FFmpeg 5.1.9 (`-c:v copy`). Its video packet
  payload SHA-256 matches the MP4 source.
- `synthetic-h264-test-pattern-frame.jpg` is one JPEG decoded at 1 second from
  the synthetic MP4 with the pinned FFmpeg 9.0.2 build. Browser-intercepted
  Muse fixtures return these exact bytes so the client can exercise evidence
  hash and frame-identity checks without contacting a provider.
