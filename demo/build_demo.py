#!/usr/bin/env python3
"""Builds the Chirp demo from the Mac (simulator) and phone recordings.

Each segment renders to its own 1920x1080 30 fps clip, then the clips are joined.
Mac and phone are synced per segment by an event both show (the phone's chirp and
the lens change it caused), because the two recordings drift relative to each other.
"""
import os, subprocess, sys

HOME = os.path.expanduser("~")
MAC = f"{HOME}/Downloads/export-1795616563882.mp4"
PHONE = f"{HOME}/Downloads/WhatsApp Video 2026-11-25 at 7.57.38 PM.mp4"
PNG = f"{HOME}/chirp/demo/cards/png"
WORK = f"{HOME}/.hermes/cache/scratch/demo/build"
OUT = f"{HOME}/Movies/chirp-demo.mp4"
LENS_CROP = "crop=1180:740:2032:505"  # the simulator window, buttons included
BG = "0x111213"
os.makedirs(WORK, exist_ok=True)

# (name, kind, args)
SEGMENTS = [
    ("01_pitch1", "card", dict(png="pitch1", dur=4.5)),
    ("02_pitch2", "card", dict(png="pitch2", dur=6.0)),
    ("03_bill_phone", "phone", dict(p=(153.0, 158.4), cap="c_bill1")),
    ("04_bill_lens", "side", dict(p=158.4, m=(138.4, 144.2), cap="c_bill2")),
    ("05_bill_tg", "phone", dict(p=(173.0, 178.0), cap="c_bill3")),
    # the screen recorder auto-zooms the Mac capture from 14.5 s to 17.4 s; skip that stretch on both sides
    ("06a_pair", "side", dict(p=29.0, m=(11.0, 14.4), cap="c_pair")),
    ("06b_pair", "side", dict(p=36.4, m=(18.4, 21.0), cap="c_pair")),
    ("07_sound", "side", dict(p=47.0, m=(27.5, 32.4), cap="c_sound")),
    ("08_talk_setup", "phone", dict(p=(62.0, 94.5), cap="c_talk1", speed=4)),
    ("09_talk_slide", "side", dict(p=96.0, m=(76.8, 84.3), cap="c_talk2")),
    ("10_end", "lens", dict(m=(95.0, 101.0), cap="c_end")),
    ("11_closer", "card", dict(png="closer", dur=8.0)),
]

ENC = ["-r", "30", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-an"]


def run(args):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args])
    if r.returncode:
        sys.exit(f"ffmpeg failed: {' '.join(args)}")


def build(name, kind, a):
    out = f"{WORK}/{name}.mp4"
    if kind == "card":
        d = a["dur"]
        run(["-loop", "1", "-t", str(d), "-i", f"{PNG}/{a['png']}.png",
             "-vf", f"scale=1920:1080,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st={d-0.4}:d=0.4", *ENC, out])
    elif kind == "phone":
        s, e = a["p"]; sp = a.get("speed", 1)
        d = (e - s) / sp
        run(["-ss", str(s), "-t", str(e - s), "-i", PHONE,
             "-i", f"{PNG}/{a['cap']}.png", "-i", f"{PNG}/labels_phone.png",
             "-filter_complex",
             f"color=c={BG}:s=1920x1080:r=30:d={d}[bg];"
             f"[0:v]fps=30,setpts=(PTS-STARTPTS)/{sp},scale=-2:880,setsar=1[ph];"
             f"[bg][ph]overlay=(W-w)/2:100:shortest=1[v1];[v1][2:v]overlay[v2];[v2][1:v]overlay,format=yuv420p",
             "-t", str(d), *ENC, out])
    elif kind == "side":
        ms, me = a["m"]; d = me - ms; ps = a["p"]
        run(["-ss", str(ms), "-t", str(d), "-i", MAC, "-ss", str(ps), "-t", str(d), "-i", PHONE,
             "-i", f"{PNG}/{a['cap']}.png", "-i", f"{PNG}/labels_side.png",
             "-filter_complex",
             f"color=c={BG}:s=1920x1080:r=30:d={d}[bg];"
             f"[0:v]fps=30,setpts=PTS-STARTPTS,{LENS_CROP},scale=1300:-2,setsar=1[lens];"
             f"[1:v]fps=30,setpts=PTS-STARTPTS,scale=-2:860,setsar=1[ph];"
             f"[bg][lens]overlay=60:105:shortest=1[v1];[v1][ph]overlay=1440:100[v2];"
             f"[v2][3:v]overlay[v3];[v3][2:v]overlay,format=yuv420p",
             "-t", str(d), *ENC, out])
    elif kind == "lens":
        ms, me = a["m"]; d = me - ms
        run(["-ss", str(ms), "-t", str(d), "-i", MAC,
             "-i", f"{PNG}/{a['cap']}.png", "-i", f"{PNG}/labels_lens.png",
             "-filter_complex",
             f"color=c={BG}:s=1920x1080:r=30:d={d}[bg];"
             f"[0:v]fps=30,setpts=PTS-STARTPTS,{LENS_CROP},scale=1400:-2,setsar=1[lens];"
             f"[bg][lens]overlay=260:60:shortest=1[v1];[v1][2:v]overlay[v2];[v2][1:v]overlay,format=yuv420p",
             "-t", str(d), *ENC, out])
    return out


if __name__ == "__main__":
    clips = []
    for name, kind, a in SEGMENTS:
        clips.append(build(name, kind, a))
        print("built", name, flush=True)
    lst = f"{WORK}/list.txt"
    with open(lst, "w") as f:
        f.writelines(f"file '{c}'\n" for c in clips)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", OUT])
    print("wrote", OUT)
