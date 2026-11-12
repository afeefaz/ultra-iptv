// Generates local test video for the dev mock provider (apps/web/dev/fixtures.ts). Needs ffmpeg.
// Output: apps/web/dev/media/ (gitignored), about 40 MB. Run: node scripts/make-test-media.mjs [--force] [--mkv]
// Looks that are already complete are skipped unless --force is given.
//
//   <look>/video/seg000.ts …      HLS video rendition (640x360, 2 s segments, 5 min loop)
//   <look>/audio_eng|audio_ara/   HLS audio renditions (two languages, for the track picker)
//   <look>/muxed.ts               one MPEG-TS file (video + English audio) for the mpegts.js path
//   <look>/movie.mp4              the same as a fast-start MP4, for movies/episodes (seekable)
//   subs/eng|ara/seg000.vtt …     WebVTT subtitle segments aligned to the video timeline
//   desktop/movie.mkv             with --mkv: 1080p HEVC 10-bit, AC-3 5.1 + E-AC-3 + DTS, SRT + ASS (30 s),
//                                 served for .mkv movies; for players that can (the Mac app's mpv, Android)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'apps/web/dev/media';
const SECONDS = 300;
const SEGMENT = 2;
const LOOKS = {
  a: `testsrc2=size=640x360:rate=25`,
  b: `smptehdbars=size=640x360:rate=25`,
  // Cheap to render; the Mandelbrot source took hours for 5 minutes of video.
  c: `testsrc2=size=640x360:rate=25,hue=H=2*PI*t/10`,
};

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

const audioInputs = [
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:beep_factor=4',
];
const videoCodec = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
  '-b:v', '400k', '-maxrate', '450k', '-bufsize', '800k', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
];
const audioCodec = ['-c:a', 'aac', '-b:a', '64k', '-ac', '2'];

const force = process.argv.includes('--force');

// What browsers can't play and mpv / ExoPlayer can: one file with every awkward format.
if (process.argv.includes('--mkv') && (force || !existsSync(join(OUT, 'desktop', 'movie.mkv')))) {
  const dir = join(OUT, 'desktop');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'en.srt'), '1\n00:00:01,000 --> 00:00:25,000\nEnglish SRT subtitle\n');
  writeFileSync(
    join(dir, 'ar.ass'),
    '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, Alignment\nStyle: Default,Arial,48,&H0000FFFF,2\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:25.00,Default,ASS subtitle (yellow)\n',
  );
  console.log('desktop/movie.mkv');
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=30',
    '-i', join(dir, 'en.srt'), '-i', join(dir, 'ar.ass'),
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-map', '4', '-map', '5',
    '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-preset', 'ultrafast', '-x265-params', 'log-level=error',
    '-c:a:0', 'ac3', '-ac:a:0', '6', '-c:a:1', 'eac3', '-c:a:2', 'dca', '-strict', '-2', '-c:s:0', 'srt', '-c:s:1', 'ass',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=AC-3 5.1', '-metadata:s:a:1', 'language=ara', '-metadata:s:a:1', 'title=E-AC-3',
    '-metadata:s:a:2', 'language=fra', '-metadata:s:a:2', 'title=DTS', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:1', 'language=ara',
    join(dir, 'movie.mkv'),
  ]);
}
for (const [look, source] of Object.entries(LOOKS)) {
  const dir = join(OUT, look);
  if (!force && existsSync(join(dir, 'muxed.ts')) && existsSync(join(dir, 'video', 'index.m3u8'))) {
    console.log(`look ${look}: already generated, skipping`);
    continue;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`look ${look}: HLS renditions…`);
  ffmpeg([
    '-f', 'lavfi', '-i', source, ...audioInputs, '-t', String(SECONDS),
    '-map', '0:v', '-map', '1:a', '-map', '2:a', ...videoCodec, ...audioCodec,
    '-muxdelay', '0', '-muxpreload', '0',
    '-f', 'hls', '-hls_time', String(SEGMENT), '-hls_list_size', '0', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(dir, '%v', 'seg%03d.ts'),
    '-var_stream_map', 'v:0,agroup:aud,name:video a:0,agroup:aud,language:eng,name:audio_eng,default:yes a:1,agroup:aud,language:ara,name:audio_ara',
    '-master_pl_name', 'master.m3u8',
    join(dir, '%v', 'index.m3u8'),
  ]);
  console.log(`look ${look}: muxed TS…`);
  ffmpeg([
    '-f', 'lavfi', '-i', source, ...audioInputs.slice(0, 4), '-t', String(SECONDS),
    '-map', '0:v', '-map', '1:a', ...videoCodec, ...audioCodec, '-muxdelay', '0', '-muxpreload', '0',
    '-f', 'mpegts', join(dir, 'muxed.ts'),
  ]);
}

// Movies/episodes: remux (no re-encode) so progressive playback and seeking can be tested.
for (const look of Object.keys(LOOKS)) {
  const mp4 = join(OUT, look, 'movie.mp4');
  if (!force && existsSync(mp4)) continue;
  console.log(`look ${look}: MP4…`);
  ffmpeg(['-i', join(OUT, look, 'muxed.ts'), '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', mp4]);
}

// Subtitles: one cue per segment. X-TIMESTAMP-MAP ties local time 0 to the video's first PTS.
// ffprobe prints e.g. "7200,"; parseInt ignores the trailing comma.
const firstPts = parseInt(
  execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts', '-read_intervals', '%+#1', '-of', 'csv=p=0',
    join(OUT, 'a', 'video', 'seg000.ts'),
  ])
    .toString()
    .trim()
    .split('\n')[0],
  10,
);
const ts = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `00:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000`;
};
const TEXT = {
  eng: (s) => `English subtitles · ${ts(s).slice(3, 8)}`,
  ara: (s) => `ترجمة عربية · ${ts(s).slice(3, 8)}`,
};
for (const lang of Object.keys(TEXT)) {
  const dir = join(OUT, 'subs', lang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (let k = 0; k < SECONDS / SEGMENT; k++) {
    const start = k * SEGMENT;
    writeFileSync(
      join(dir, `seg${String(k).padStart(3, '0')}.vtt`),
      `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:${firstPts},LOCAL:00:00:00.000\n\n${ts(start)} --> ${ts(start + SEGMENT)}\n${TEXT[lang](start)}\n`,
    );
  }
}

const segments = readFileSync(join(OUT, 'a', 'video', 'index.m3u8'), 'utf8').split('\n').filter((l) => l.endsWith('.ts')).length;
writeFileSync(join(OUT, 'info.json'), JSON.stringify({ seconds: SECONDS, segment: SEGMENT, segments, firstPts }, null, 2));
console.log(`done: ${segments} segments per rendition, first PTS ${firstPts}${existsSync(join(OUT, 'c', 'muxed.ts')) ? '' : ' (muxed TS missing!)'}`);
