from pathlib import Path
import os

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT / "assets-src" / "cars"
MODELS = PROJECT / "public" / "models"
TEXTURES = MODELS / "textures" / "cars"
SOURCE = Path(os.environ.get("TESLA_REF_DIR", PROJECT.parent / "ref")) / "cars"

PALETTE = {
    "white": "e8e6e1", "silver": "a9adb2", "black": "0d0e10",
    "darkgrey": "3a3d42", "darkblue": "16233f", "red": "6e1f1c",
}
# Length in metres, supplied diffuse, supplied wheel atlas, default then alternates.
CARS = {
    "sedan": (4.70, "SedanYellow", "Wheel_A", ("silver", "white", "black", "red")),
    "wagon": (4.75, "WagonBlue", "Wheel_A", ("darkblue", "silver", "darkgrey")),
    "hatchback": (4.25, "HatchbackYellow", "wheel_B", ("white", "darkgrey", "darkblue")),
    "compact": (3.90, "CompactBlue", "wheel_C", ("darkgrey", "white", "silver")),
    "coupe": (4.50, "CoupeBlue", "wheel_1", ("red", "silver", "black", "darkblue")),
    "minivan": (5.10, "MinivanRed", "wheel_D", ("white", "silver", "darkgrey")),
    "pickup": (5.40, "PickupGreen", "wheel_E", ("darkgrey", "silver", "white")),
    "suv": (4.70, "SUVBlack", "wheel_E", ("black", "white", "darkblue", "silver")),
    "offroad": (4.60, "OffroadGreen", "wheel_G", ("silver", "black", "darkgrey")),
}


def texture_prefix(kind):
    return "SUV" if kind == "suv" else kind.capitalize()
