"""Analytics and Dashboard routes."""
from functools import wraps
from flask import Blueprint, render_template

analytics_bp = Blueprint("analytics", __name__, template_folder=".")

_LOGIN_REQUIRED = None


def init_analytics(login_required):
    """Pass in the app's login decorator without importing app.py directly."""
    global _LOGIN_REQUIRED
    _LOGIN_REQUIRED = login_required


def _guard(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if _LOGIN_REQUIRED is not None:
            return _LOGIN_REQUIRED(view)(*args, **kwargs)
        return view(*args, **kwargs)

    return wrapper


@analytics_bp.route("/analytics", methods=["GET"])
@_guard
def analytics_page():
    """Serve the single-page application focused on the Dashboard / Analytics tab."""
    return render_template("index.html", initial_tab="dashboard")
