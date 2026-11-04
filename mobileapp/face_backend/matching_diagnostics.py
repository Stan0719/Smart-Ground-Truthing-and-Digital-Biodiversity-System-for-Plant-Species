"""Opt-in server metadata only; never expose gallery identities or biometric vectors."""
from image_pipeline import diagnostic
from image_pipeline import request_reference
import json


def matching_outcome(compared_templates, matched_accounts):
    """Always retain a request outcome, without identities, scores or biometrics."""
    print(json.dumps({'event': 'face_matching_outcome',
                      'reference': request_reference.get(),
                      'comparedTemplates': compared_templates,
                      'matchedAccounts': matched_accounts}), flush=True)


def matching_diagnostic(distances, **values):
    diagnostic('matching_completed', metric='cosine',
               comparedTemplates=len(distances),
               closestDistance=round(min(distances), 4) if distances else None,
               **values)
