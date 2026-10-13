"""Opt-in server metadata only; never expose gallery identities or biometric vectors."""
from image_pipeline import diagnostic


def matching_diagnostic(distances, **values):
    diagnostic('matching_completed', metric='cosine',
               comparedTemplates=len(distances),
               closestDistance=round(min(distances), 4) if distances else None,
               **values)
