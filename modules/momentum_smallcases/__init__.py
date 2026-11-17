"""
CAPITAL DESK - MOMENTUM SMALLCASES MODULE
"""

from modules.momentum_smallcases.momentum_smallcases_routes import (
    momentum_smallcases_bp,
    init_routes,
)
from modules.momentum_smallcases.momentum_smallcases_store import (
    init_store,
    load_user_momentum_smallcases,
    save_user_momentum_smallcases,
)


def init_momentum_smallcases(fetcher=None, login_required=None, data_dir=None):
    """Initializes the Momentum Smallcases module."""
    init_store(fetcher=fetcher, data_dir=data_dir)
    init_routes(login_required_fn=login_required)


__all__ = [
    "momentum_smallcases_bp",
    "init_momentum_smallcases",
    "load_user_momentum_smallcases",
    "save_user_momentum_smallcases",
]
