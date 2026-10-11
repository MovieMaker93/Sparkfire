"""FastH3 graphs in ComfyUI's API format.

They reproduce FastVideo's official "FastH3: Text to Video" and "Image to Video" templates as of ComfyUI
0df64eb (sampler, sigma shift, sparse attention, decoders), with the template's math, resolution and image
size nodes replaced by values the adapter computes. Those settings are the ones the FastH3 model cards ask
for and the ones measured on the Spark (docs/validation.md); change them only together with a new
measurement.
"""

FPS = 24
STEPS = 8

SCENE_KEY = "integrated_multimodal_description:"
SOUND_KEY = "overall_soundscape:"
MUSIC_KEY = "non_diegetic_music:"
# The template's own wording for "the uploaded image is the first frame"; FastH3 was trained on it.
FIRST_FRAME_REFERENCE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."

SAVE_NODE = "save"


def frames_for(duration: float) -> int:
    """The template's frame count: duration at 24 fps, rounded up to the model's 17k+5 grid (5 s is 124)."""
    frames = max(5, round(duration * FPS))
    return frames + (5 - frames % 17) % 17


def format_prompt(scene: str, sound: str = "", music: str = "", first_frame: bool = False) -> str:
    """Puts a plain description into the sectioned format FastH3 was trained on.

    A prompt that already uses the sections is kept as written; sound and music are added only as sections
    it lacks.
    """
    text = scene.strip()
    if SCENE_KEY not in text:
        text = f"{SCENE_KEY} [Shot 1] {text}"
    if sound.strip() and SOUND_KEY not in text:
        text += f"\n{SOUND_KEY} {sound.strip()}"
    if music.strip() and MUSIC_KEY not in text:
        text += f"\n{MUSIC_KEY} {music.strip()}"
    if first_frame and "<Picture 1>" not in text:
        text = f"{FIRST_FRAME_REFERENCE}\n{text}"
    return text


def build_graph(
    *,
    prompt: str,
    width: int,
    height: int,
    frames: int,
    seed: int,
    unet: str,
    text_encoder: str,
    video_vae: str,
    audio_vae: str,
    filename_prefix: str,
    first_frame: str | None = None,
) -> dict:
    """One FastH3 generation. `first_frame` is the name of an image in ComfyUI's input folder."""
    graph: dict = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "shift": {"class_type": "MiniMaxH3SigmaShift", "inputs": {"model": ["unet", 0], "shift_video": 10, "shift_audio": 3}},
        "attention": {"class_type": "ModelAttentionBackend", "inputs": {"model": ["shift", 0], "attention": "comfy kitchen attention"}},
        # Video Sparse Attention at the 10% the FastH3 checkpoints were trained with.
        "sparse": {
            "class_type": "BlockSparseAttention",
            "inputs": {
                "model": ["attention", 0],
                "selection": "vsa",
                "selection.keep_percent": 10,
                "start_percent": 0.2,
                "end_percent": 1,
                "dense_blocks": "",
                "min_tokens": 12288,
                "extra_tokens": 256,
                "sink_conditioning": "exact_kv_and_rows",
                "verbose": False,
            },
        },
        "text_encoder": {"class_type": "CLIPLoader", "inputs": {"clip_name": text_encoder, "type": "minimax", "device": "default"}},
        "video_vae": {"class_type": "VAELoader", "inputs": {"vae_name": video_vae}},
        "audio_vae": {"class_type": "VAELoader", "inputs": {"vae_name": audio_vae}},
        "conditioning": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {"clip": ["text_encoder", 0], "vae": ["video_vae", 0], "prompt": prompt, "width": width, "height": height, "length": frames},
        },
        "noise": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "guider": {"class_type": "BasicGuider", "inputs": {"model": ["sparse", 0], "conditioning": ["conditioning", 0]}},
        "sampler": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "sigmas": {"class_type": "BasicScheduler", "inputs": {"model": ["sparse", 0], "scheduler": "simple", "steps": STEPS, "denoise": 1}},
        "sample": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {"noise": ["noise", 0], "guider": ["guider", 0], "sampler": ["sampler", 0], "sigmas": ["sigmas", 0], "latent_image": ["conditioning", 1]},
        },
        "decode_video": {"class_type": "VAEDecode", "inputs": {"samples": ["sample", 0], "vae": ["video_vae", 0]}},
        "decode_audio": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["sample", 0], "vae": ["audio_vae", 0]}},
        "video": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["decode_video", 0], "fps": FPS, "audio": ["decode_audio", 0], "bit_depth": "auto", "color_space": "sRGB", "codec": "none"},
        },
        SAVE_NODE: {"class_type": "SaveVideo", "inputs": {"video": ["video", 0], "filename_prefix": filename_prefix, "format": "auto", "codec": "auto"}},
    }
    if first_frame:
        # The template scales the image to about 0.4 MP and lets the video follow its shape; scaling it to the
        # requested size (centre crop) keeps the size the user picked.
        graph["first_frame"] = {"class_type": "LoadImage", "inputs": {"image": first_frame}}
        graph["first_frame_scaled"] = {
            "class_type": "ImageScale",
            "inputs": {"image": ["first_frame", 0], "upscale_method": "lanczos", "width": width, "height": height, "crop": "center"},
        }
        graph["conditioning"]["inputs"]["first_frame"] = ["first_frame_scaled", 0]
    return graph
