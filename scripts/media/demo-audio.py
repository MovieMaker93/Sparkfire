"""About 35 seconds of real read speech (LibriSpeech, CC BY 4.0) as one WAV, for the transcription demo."""
import io
import sys

import numpy as np
import pyarrow.parquet as pq
import soundfile

rows = pq.read_table(sys.argv[1]).to_pylist()
clips, total = [], 0.0
for row in rows:
    data, rate = soundfile.read(io.BytesIO(row["audio"]["bytes"]))
    clips.append(data)
    clips.append(np.zeros(int(rate * 0.6)))
    total += len(data) / rate
    if total > 35:
        break
soundfile.write(sys.argv[2], np.concatenate(clips), rate, subtype="PCM_16")
print(f"{sys.argv[2]}: {total:.1f}s of speech")
