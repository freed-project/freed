These scripts reproduce the bundled graph. Python is conversion tooling only.
Run them in a separate temporary directory, never an installed application data root.

1. Copy these scripts and the pinned metadata JSON to the temporary directory.
2. Extract the official GLiClass archive at commit `68132def761c2dccc20d1a71c04abdc5db35463f` into `source/`.
3. Create a Python 3.13 virtual environment. Install `torch==2.7.1 transformers==4.48.2 onnx==1.18.0 onnxruntime==1.22.0 scikit-learn==1.6.1 numpy==2.2.6`. Resolve and record the dependency set for the conversion host.
4. Run `download-pinned.py` once. It validates published sizes and LFS SHA-256 or Git blob identities before recording SHA-256 for every source file.
5. Run `export-validate.py` with `PYTHONPATH=source OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1`. It uses local-only model loading, checks that no weights were missing or unexpected, exports the entire logits graph and compares synthetic outputs against the original model.
6. Run `externalize-official.py`. Every initializer must match an exact official safetensors byte range. Confirm `unmatchedBytes` is zero and the resulting graph matches `../provenance.json`. The result is `model/model.onnx`; keep the original safetensors beside it for runtime validation.
7. Run the native Rust tokenizer and ONNX Runtime on the same synthetic cases. Compare native logits to the conversion receipt before replacing the checked-in graph.

The graph uses ONNX opset 17, batch one, 25 fixed class slots and dynamic sequence length. Application code enforces at most 512 tokens and rejects evidence truncation. The model card license and source license are Apache-2.0; preserve the neighboring LICENSE, NOTICE and provenance when distributing the graph.
