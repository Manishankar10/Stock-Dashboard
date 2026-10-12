"""Smallcases routes module - aliases smallcases.py for compatibility."""
from .smallcases import *  # noqa: F401, F403
from .smallcases import (
    smallcases_bp,
    init_smallcases,
    load_user_smallcases,
    save_user_smallcases,
)

__all__ = [
    "smallcases_bp",
    "init_smallcases",
    "load_user_smallcases",
    "save_user_smallcases",
]
