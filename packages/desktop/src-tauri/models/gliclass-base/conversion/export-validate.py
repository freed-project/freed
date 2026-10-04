# Build-only Python tooling. Inference package must not depend on Python.
import os
os.environ.update({'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1','TOKENIZERS_PARALLELISM':'false'})
import json, pathlib, time, hashlib, resource
import numpy as np
import torch, onnx, onnxruntime as ort
from transformers import AutoTokenizer
from gliclass import GLiClassModel
root = pathlib.Path(__file__).parent
model_path = root / 'model'; output = root / 'export'; output.mkdir(exist_ok=True)
torch.set_num_threads(1); torch.set_num_interop_threads(1)
model, loading = GLiClassModel.from_pretrained(str(model_path), local_files_only=True, output_loading_info=True)
assert not loading['missing_keys'], loading
assert not loading['unexpected_keys'], loading
model.eval(); tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True)
assert tokenizer.convert_tokens_to_ids('<<LABEL>>') == 128001
assert tokenizer.convert_tokens_to_ids('<<SEP>>') == 128002
class Logits(torch.nn.Module):
    def __init__(self, model): super().__init__(); self.model = model
    def forward(self, input_ids, attention_mask):
        return self.model(input_ids=input_ids, attention_mask=attention_mask, max_num_classes=25).logits
wrapped = Logits(model).eval()
def encode(text, labels):
    value = ''.join('<<LABEL>>' + label for label in labels) + '<<SEP>>' + text
    tokens = tokenizer(value, return_tensors='pt', truncation=False)
    assert tokens['input_ids'].shape[1] <= 512
    assert (tokens['input_ids'] == 128001).sum().item() == len(labels)
    return tokens['input_ids'], tokens['attention_mask']
example = encode('Join our synthetic community supper tonight.', ['event invitation','help request','product update','news report'])
start=time.perf_counter()
torch.onnx.export(wrapped, example, str(output/'model.onnx'), input_names=['input_ids','attention_mask'], output_names=['logits'], dynamic_axes={'input_ids':{1:'sequence_length'},'attention_mask':{1:'sequence_length'}}, opset_version=17, do_constant_folding=False, dynamo=False)
export_ms=(time.perf_counter()-start)*1000
onnx.checker.check_model(str(output/'model.onnx'))
options=ort.SessionOptions(); options.intra_op_num_threads=1; options.inter_op_num_threads=1; options.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
start=time.perf_counter(); session=ort.InferenceSession(str(output/'model.onnx'), options, providers=['CPUExecutionProvider']); load_ms=(time.perf_counter()-start)*1000
cases=[('Join our synthetic community supper tonight.', ['event invitation','help request','product update','news report']), ('I need help repairing a bicycle.', ['help request']), ('We released a patch fixing the login error.', ['label '+str(i) for i in range(25)]), ('Grants close Friday. Apply now.', ['deadline','grant opportunity']), ('Thank you for your help.', ['gratitude','request','sale'])]
results=[]
for text,labels in cases:
    ids,mask=encode(text,labels)
    with torch.inference_mode(): expected=wrapped(ids,mask).numpy()
    start=time.perf_counter(); actual=session.run(['logits'],{'input_ids':ids.numpy(),'attention_mask':mask.numpy()})[0]; elapsed_ms=(time.perf_counter()-start)*1000
    assert actual.shape == (1,25), actual.shape
    error=float(np.max(np.abs(actual[:,:len(labels)]-expected[:,:len(labels)])))
    np.testing.assert_allclose(actual[:,:len(labels)], expected[:,:len(labels)], rtol=1e-3, atol=1e-3)
    results.append({'text':text,'labels':labels,'tokenCount':ids.shape[1],'maxLogitError':error,'elapsedMs':elapsed_ms,'logits':actual[0,:len(labels)].tolist(),'scores':(1/(1+np.exp(-actual[0,:len(labels)]))).tolist()})
    print(json.dumps(results[-1]),flush=True)
files=[]
for path in [output/'model.onnx',model_path/'tokenizer.json']:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    files.append({'path':path.name,'sizeBytes':path.stat().st_size,'sha256':h.hexdigest()})
receipt={'sourceRevision':'77a70e6cd52e602ed18184ef37d18bdd3741e3d5','codeRevision':'68132def761c2dccc20d1a71c04abdc5db35463f','torch':torch.__version__,'ort':ort.__version__,'provider':session.get_providers(),'threads':1,'exportMs':export_ms,'loadMs':load_ms,'peakRssPlatformUnits':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'platform':os.uname().sysname,'cases':results,'files':files}
(root/'conversion-receipt.json').write_text(json.dumps(receipt,indent=2))
print('FULL GRAPH VALIDATED',flush=True)
