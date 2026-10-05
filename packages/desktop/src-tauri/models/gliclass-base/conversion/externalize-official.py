# Reuse exact published safetensors bytes as ONNX external initializer data.
import pathlib, json, hashlib, mmap, os
import onnx
from onnx import external_data_helper
root=pathlib.Path(__file__).parent
with (root/'model/model.safetensors').open('rb') as stream:
    data=mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
    header_size=int.from_bytes(data[:8],'little'); header=json.loads(data[8:8+header_size]);start=8+header_size
    lookup={}
    for name,entry in header.items():
        if name=='__metadata__':continue
        lo,hi=entry['data_offsets'];view=memoryview(data)[start+lo:start+hi]
        lookup[hashlib.sha256(view).hexdigest()]=(name,start+lo,hi-lo)
        del view
    graph=onnx.load(str(root/'export/model.onnx'))
    matches=[]; unmatched=[]
    for tensor in graph.graph.initializer:
        match=lookup.get(hashlib.sha256(tensor.raw_data).hexdigest())
        if not match: unmatched.append({'name':tensor.name,'bytes':len(tensor.raw_data)});continue
        name,offset,length=match
        external_data_helper.set_external_data(tensor,location='model.safetensors',offset=offset,length=length)
        tensor.ClearField('raw_data');tensor.data_location=onnx.TensorProto.EXTERNAL
        matches.append({'initializer':tensor.name,'sourceTensor':name,'offset':offset,'bytes':length})
    if unmatched:
        raise RuntimeError(f'Cannot promote graph: {len(unmatched)} initializers do not match official weights')
    target=root/'model/model.onnx';onnx.save_model(graph,str(target))
    if target.stat().st_size > 2_000_000:
        raise RuntimeError('Cannot promote graph: unexpected embedded weight data')
    receipt={'graphBytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'externalizedBytes':sum(x['bytes'] for x in matches),'unmatchedBytes':sum(x['bytes'] for x in unmatched),'unmatched':unmatched,'matches':matches}
    (root/'external-data-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps({k:v for k,v in receipt.items() if k not in ['matches','unmatched']}),flush=True)
    onnx.checker.check_model(str(target))
    del data
