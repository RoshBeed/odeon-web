"""The public programme conventions shared by Jacro cinema sites."""

import re
from datetime import datetime


def fields(root, cls, label_tag):
    container = next(root.find(cls=cls), None)
    props = {}
    if container:
        for node in container.find("li" if cls == "movie-info" else "p"):
            label = next(node.find(label_tag), None)
            if label:
                props[label.text.rstrip(":")] = node.text.removeprefix(
                    label.text
                ).strip()
    return props


def listing_day(text, today):
    text = re.sub(r"(\d+)(st|nd|rd|th)\b", r"\1", text).replace(",", "")
    # Checking the weekday also dates next spring's advance bookings in November.
    years = (
        (None,)
        if re.search(r"\b\d{4}$", text)
        else (today.year - 1, today.year, today.year + 1)
    )
    for year in years:
        try:
            day = datetime.strptime(
                text if year is None else f"{text} {year}", "%A %d %B %Y"
            ).date()
        except ValueError:
            continue
        if day.strftime("%A") == text.split()[0]:
            return day
    raise RuntimeError(f"Unrecognised programme date {text}")
