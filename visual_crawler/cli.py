"""CLI entry point for the Visual API Crawler."""

# Standard library
import argparse
import logging
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
    parser.add_argument("--log-level", type=str, default="INFO",
                       choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
                       help="Logging level (default: INFO)")
    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    app = create_app()

    print(f"\n🚀  Salt Security - Visual Scanner")
    print(f"    Dashboard: http://localhost:{args.port}")
    print(f"    Open the URL above in your browser and enter your scan parameters\n")

    webbrowser.open(f"http://localhost:{args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
