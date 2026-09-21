"""Phase 2: Release-Ticketliste gegen vorhandene bereinigte Tickets
abgleichen und fehlende Tickets ausweisen."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ReleaseMatchResult:
    release_name: str
    found: list[str]
    missing: list[str]
    extra: list[str]

    @property
    def total_requested(self) -> int:
        return len(self.found) + len(self.missing)

    def as_markdown(self) -> str:
        lines = [f"# Release-Abgleich: {self.release_name}", ""]
        lines.append(
            f"{len(self.found)} von {self.total_requested} Tickets des Release "
            f"sind vorhanden. {len(self.missing)} fehlen."
        )
        lines.append("")
        lines.append("## Fehlende Tickets")
        lines.append("")
        if self.missing:
            for key in self.missing:
                lines.append(f"- [ ] {key}")
        else:
            lines.append("Keine - alle Tickets des Release sind vorhanden.")
        lines.append("")
        lines.append("## Vorhandene Tickets des Release")
        lines.append("")
        for key in self.found:
            lines.append(f"- [x] {key}")
        if self.extra:
            lines.append("")
            lines.append(
                "## Weitere bereinigte Tickets (nicht Teil dieser Release-Liste)"
            )
            lines.append("")
            for key in self.extra:
                lines.append(f"- {key}")
        lines.append("")
        return "\n".join(lines)


def match_release(
    release_name: str, release_keys: list[str], available_keys: list[str]
) -> ReleaseMatchResult:
    release_norm = [k.strip().upper() for k in release_keys if k.strip()]
    available_norm = {k.strip().upper(): k.strip() for k in available_keys}

    found = [release_to_original(k, available_norm) for k in release_norm if k in available_norm]
    missing = [k for k in release_norm if k not in available_norm]
    extra_keys = sorted(set(available_norm) - set(release_norm))
    extra = [available_norm[k] for k in extra_keys]

    return ReleaseMatchResult(
        release_name=release_name, found=found, missing=missing, extra=extra
    )


def release_to_original(key_upper: str, available_norm: dict[str, str]) -> str:
    return available_norm[key_upper]
