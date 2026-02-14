"""CLI entry point for the Visual API Crawler."""

# Standard library
import argparse
import webbrowser

# Third-party
import uvicorn

# Local imports
from .server import create_app


def main():
    """Main entry point for the Visual API Crawler CLI."""
    parser = argparse.ArgumentParser(description="Live Visual API Discovery Crawler")
    parser.add_argument("--port", type=int, default=8187,
                       help="Port to run the dashboard on (default: 8187)")
    args = parser.parse_args()

    app = create_app()

    print(f"\n🚀  Salt Security - Visual Scanner")
    print(f"    Dashboard: http://localhost:{args.port}")
    print(f"    Open the URL above in your browser and enter your scan parameters\n")

    webbrowser.open(f"http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
