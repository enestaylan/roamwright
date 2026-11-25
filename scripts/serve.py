"""Serve the checkout for the interactive examples and browser fixtures."""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class ExampleServer(ThreadingHTTPServer):
    # ES modules fan out into parallel requests on a cold browser load.
    request_queue_size = 128


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    with ExampleServer(("127.0.0.1", port), Handler) as server:
        print(f"Serving Roamwright on port {server.server_port}", flush=True)
        print(f"http://127.0.0.1:{server.server_port}/examples/viaduct.html?seed=42", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
