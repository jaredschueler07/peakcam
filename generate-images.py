#!/usr/bin/env python3
"""
PeakCam — Grok Imagine Image Generator
Generates all brand images via the xAI Grok Imagine API.

Usage:
    export XAI_API_KEY="your-api-key-here"
    python generate-images.py

Options:
    --dry-run       Print prompts without calling the API
    --only IMAGE    Generate only one image by key (e.g. --only hero-mountain)
    --model MODEL   Model to use (default: grok-imagine-image)
    --output DIR    Output directory (default: ./public/images/)
"""

import os
import sys
import json
import base64
import argparse
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("ERROR: 'requests' is required. Install with: pip install requests")
    sys.exit(1)


# ─── Config ──────────────────────────────────────────────────────────────────

API_URL = "https://api.x.ai/v1/images/generations"
DEFAULT_MODEL = "grok-imagine-image"
DEFAULT_OUTPUT = os.path.join(os.path.dirname(__file__), "public", "images")

# ─── Image Definitions ───────────────────────────────────────────────────────
# Each entry: key, filename, aspect_ratio, prompt

IMAGES = [
    {
        "key": "hero-mountain",
        "filename": "hero-mountain.jpg",
        "aspect_ratio": "16:9",
        "prompt": (
            "Intimate landscape photography, early morning. A closer view of a single "
            "mountain peak with fresh snow, seen through a frame of tall pine trees. "
            "Soft warm light just starting to hit the peak while the forest is still in "
            "cool shadow. Wisps of morning mist rising from the trees. A sense of quiet "
            "solitude — this is someone's backyard mountain, not a famous peak. Warm earth "
            "tones in the foreground — brown pine needles, weathered bark, patches of snow. "
            "Natural film grain, slightly underexposed like real dawn light. Color palette: "
            "soft peach on the peak (#E8B896), cool forest shadow (#2A3540), warm earth "
            "(#8B6B4A), morning mist (#D4C4B0). The mood is 6am, coffee in hand, watching "
            "the mountain wake up. 35mm film, editorial like Mountain Gazette or Adventure "
            "Journal."
        ),
    },
    {
        "key": "powder-banner",
        "filename": "powder-banner.jpg",
        "aspect_ratio": "2:1",
        "prompt": (
            "Ultrawide cinematic photograph of a snow-covered forest trail disappearing "
            "into golden morning mist. Tall pines on both sides creating a natural corridor. "
            "Fresh untouched powder on the trail, animal tracks barely visible. The mist "
            "ahead glows warm amber from the rising sun. Snow is actively falling — soft, "
            "large flakes. The trail curves gently, inviting you forward into the warm "
            "light. The trees have heavy snow on their branches, some dropping clumps. "
            "Warm earth tones in the tree bark contrasting with cool white snow. Film grain, "
            "natural color, slightly warm cast. The feeling is anticipation — the best part "
            "of the day is ahead. Pacific Northwest backcountry, no signage, no grooming."
        ),
    },
    {
        "key": "card-texture-co",
        "filename": "card-texture-co.jpg",
        "aspect_ratio": "2:3",
        "prompt": (
            "Very dark abstract texture for a card background. Close-up of dark-stained "
            "reclaimed barn wood planks, heavily weathered with nail holes and saw marks. "
            "Deep warm brown-black (#1A1510) to near-black (#0D0B08). The wood grain is "
            "prominent and directional — horizontal planks. Subtle warm amber highlights "
            "on the raised grain. Some planks slightly different tones. Must be very dark "
            "(90%+ dark) for white text. Feels like the inside wall of a hundred-year-old "
            "Colorado mining cabin. Rustic, honest, full of history."
        ),
    },
    {
        "key": "card-texture-ut",
        "filename": "card-texture-ut.jpg",
        "aspect_ratio": "2:3",
        "prompt": (
            "Very dark abstract texture for a card background. Dried, cracked desert "
            "clay or mud — the kind found in dry Utah lake beds. Deep rust-brown (#1A0F0D) "
            "to near-black (#0D0908). The crack pattern is organic and irregular, like a "
            "dried riverbed. Very subtle warm undertone in the cracks where lighter clay "
            "shows. The surface is matte and dusty. Must be very dark (90%+ dark) for "
            "white text. Feels like the desert floor in winter — frozen mud, red earth "
            "under a thin crust. Earthy, ancient, Utah high desert."
        ),
    },
    {
        "key": "card-texture-ca",
        "filename": "card-texture-ca.jpg",
        "aspect_ratio": "2:3",
        "prompt": (
            "Very dark abstract texture for a card background. Wet dark granite with a "
            "thin film of water running over the surface — like a mountain creek bed "
            "rock. Deep grey (#15130F) to near-black (#0A0908). The water creates "
            "subtle reflections and highlights on the stone surface. Small flecks of "
            "mica and quartz glinting. Very smooth, very dark, very subtle. Must be "
            "very dark (90%+ dark) for white text. Feels like a polished river stone "
            "from a Sierra Nevada creek. Smooth, cool, meditative. California mountain "
            "water energy."
        ),
    },
    {
        "key": "cam-placeholder",
        "filename": "cam-placeholder.jpg",
        "aspect_ratio": "16:9",
        "prompt": (
            "Photograph through a rain-streaked window at golden hour. The rain "
            "droplets on the glass are backlit by warm amber sunset light, each droplet "
            "glowing like a tiny amber jewel. Through the wet glass, a blurred mountain "
            "landscape is visible — dark silhouetted peaks against a warm orange-gold "
            "sky. The foreground is all about the rain on glass — bokeh, warm light, "
            "water streaks. The background mountains are soft abstract shapes. Dark "
            "overall with the warm light concentrated in the droplets and sky. The "
            "feeling is watching a storm clear from inside a warm, dry place. Hopeful, "
            "warm, patient. Film grain, shallow depth of field on the glass."
        ),
    },
    {
        "key": "fb-profile",
        "filename": "fb-profile.jpg",
        "aspect_ratio": "1:1",
        "prompt": (
            "Square social media profile picture, will be cropped to circle. "
            "Deep navy-black background (#080E1A). A dramatic jagged mountain peak "
            "silhouette — like the Matterhorn — fills the upper 60% of the frame. "
            "The summit catches warm amber-orange light (#E8A050, #F0C070) with a "
            "warm halo radiating from behind. A single electric cyan line (#22D3EE) "
            "traces the right ridgeline. Below the mountain, centered, the text "
            "'PEAKCAM' in bold condensed sans-serif uppercase — 'PEAK' in clean white "
            "(#F0F0F0), 'CAM' in bright cyan (#22D3EE). The text is large enough to "
            "read at small sizes, with generous letter-spacing. CRITICAL LAYOUT: "
            "The image will be cropped to a CIRCLE so nothing can be near the edges. "
            "The mountain peak should be compact, sitting in the upper-center. The "
            "PEAKCAM text must be in the CENTER of the frame (not the bottom), with "
            "at least 25% padding below the text to the frame edge. Everything must "
            "fit inside a circle inscribed within the square. Cinematic, high-contrast, "
            "premium outdoor brand. Dark, confident, warm."
        ),
    },
    {
        "key": "og-image",
        "filename": "og-image.jpg",
        "aspect_ratio": "16:9",
        "prompt": (
            "Dark, atmospheric social media card. A moody photograph of a mountain peak "
            "emerging from clouds and mist at dusk — warm amber light on the summit, "
            "the rest wrapped in dark blue-grey fog. Mostly dark image with the peak "
            "as a subtle focal point. The word 'PEAKCAM' in large condensed sans-serif "
            "type, warm off-white, centered in the upper portion against the dark sky. "
            "Below: 'Real conditions. No marketing noise.' in smaller type. The overall "
            "feel is understated and mysterious — you have to look to see the mountain. "
            "Like the poster for an indie climbing documentary. Dark, moody, confident, "
            "warm undertone."
        ),
    },
]


# ─── Generator ────────────────────────────────────────────────────────────────

def generate_image(api_key: str, image_def: dict, model: str, output_dir: str) -> str:
    """Generate a single image and save it. Returns the output path."""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    body = {
        "model": model,
        "prompt": image_def["prompt"],
        "n": 1,
        "response_format": "b64_json",
    }

    # Only add aspect_ratio if it's a standard ratio the API supports
    # The API uses aspect_ratio rather than pixel dimensions
    if image_def.get("aspect_ratio"):
        body["aspect_ratio"] = image_def["aspect_ratio"]

    print(f"  → Calling API for '{image_def['key']}'...")
    response = requests.post(API_URL, headers=headers, json=body, timeout=120)

    if response.status_code != 200:
        print(f"  ✗ API error {response.status_code}: {response.text[:300]}")
        return None

    data = response.json()

    # Extract base64 image data from response
    try:
        b64_data = data["data"][0]["b64_json"]
    except (KeyError, IndexError):
        # Fallback: check if URL was returned instead
        try:
            url = data["data"][0]["url"]
            print(f"  → Got URL response, downloading...")
            img_response = requests.get(url, timeout=60)
            img_bytes = img_response.content
        except (KeyError, IndexError):
            print(f"  ✗ Unexpected response format: {json.dumps(data)[:300]}")
            return None
    else:
        img_bytes = base64.b64decode(b64_data)

    # Save to disk
    output_path = os.path.join(output_dir, image_def["filename"])
    with open(output_path, "wb") as f:
        f.write(img_bytes)

    size_kb = len(img_bytes) / 1024
    print(f"  ✓ Saved {image_def['filename']} ({size_kb:.0f} KB)")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="PeakCam image generator via Grok Imagine API")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling API")
    parser.add_argument("--only", type=str, help="Generate only one image by key")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Model name")
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT, help="Output directory")
    args = parser.parse_args()

    # Validate API key
    api_key = os.environ.get("XAI_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: Set your xAI API key via: export XAI_API_KEY='your-key-here'")
        sys.exit(1)

    # Ensure output directory exists
    os.makedirs(args.output, exist_ok=True)

    # Filter images if --only is specified
    images = IMAGES
    if args.only:
        images = [img for img in IMAGES if img["key"] == args.only]
        if not images:
            valid = ", ".join(img["key"] for img in IMAGES)
            print(f"ERROR: Unknown image key '{args.only}'. Valid keys: {valid}")
            sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  PeakCam — Grok Imagine Image Generator")
    print(f"  Model:  {args.model}")
    print(f"  Output: {args.output}")
    print(f"  Images: {len(images)}")
    print(f"{'='*60}\n")

    results = {"success": [], "failed": []}

    for i, img in enumerate(images, 1):
        print(f"[{i}/{len(images)}] {img['key']} → {img['filename']}")

        if args.dry_run:
            print(f"  Aspect ratio: {img['aspect_ratio']}")
            print(f"  Prompt: {img['prompt'][:120]}...")
            print()
            continue

        path = generate_image(api_key, img, args.model, args.output)

        if path:
            results["success"].append(img["key"])
        else:
            results["failed"].append(img["key"])

        # Brief pause between requests to be polite to the API
        if i < len(images):
            time.sleep(1)

        print()

    # Summary
    if not args.dry_run:
        print(f"{'='*60}")
        print(f"  Done! {len(results['success'])}/{len(images)} images generated.")
        if results["failed"]:
            print(f"  Failed: {', '.join(results['failed'])}")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
