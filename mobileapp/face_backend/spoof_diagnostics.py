"""Observe unchanged upstream inputs/decision; never override or retry a rejection."""
import math
from image_pipeline import diagnostic


def instrument_spoof_model(model):
    if getattr(model, '_niah_observed', False):
        return model
    original = model.analyze

    def analyze(img, facial_area):
        # DeepFace calls this with img= and facial_area=; retain its API exactly.
        x, y, w, h = facial_area
        height, width = img.shape[:2]
        valid = w > 0 and h > 0 and x >= 0 and y >= 0 and x+w <= width and y+h <= height
        effective = [round(min((height-1)/h, (width-1)/w, scale), 2) for scale in (2.7, 4.0)] if w > 0 and h > 0 else []
        diagnostic('anti_spoofing_started', model='Fasnet', inputColorOrder='BGR',
                   width=width, height=height, channels=img.shape[2] if img.ndim == 3 else None,
                   dtype=str(img.dtype), boundingBoxValid=valid,
                   faceAreaFraction=round(w*h/(height*width), 3),
                   contextScales=[2.7, 4.0], effectiveContextScales=effective,
                   networkInput=[80, 80], tensorRange='0..255 float32; upstream normalization')
        result = original(img=img, facial_area=facial_area)
        # This is confidence in the WINNING class, not a calibrated probability of liveness.
        score = float(result[1])
        band = 'unavailable' if not math.isfinite(score) else 'high' if score >= 0.8 else 'moderate' if score >= 0.6 else 'low'
        diagnostic('anti_spoofing_decision', model='Fasnet', result='passed' if result[0] else 'rejected',
                   winningClassConfidenceBand=band)
        return result

    model.analyze = analyze
    model._niah_observed = True
    return model
