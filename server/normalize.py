"""Normalize already-authenticated Meta webhook data; does not contact Meta."""
from datetime import datetime,timezone
from upstream.whatsapp_webhook import parse_webhook

def normalize(payload):
 now=datetime.now(timezone.utc)
 events=[]
 for r in parse_webhook(payload,now,store_raw=True):
  raw=r['raw']; kind=r['type']; attachment=raw.get(kind,{})
  e=dict(id='message:'+r['message_id'],type='message',message_id=r['message_id'],phone=r['from'],direction='in',timestamp=r['message_timestamp'] or r['ts'],name=r['name'] or '',text=r['text'],kind=kind,students=[])
  if kind in ('image','document','audio','video','sticker') and isinstance(attachment,dict) and attachment.get('id'):
   e['media']={'reference':attachment['id'],'filename':attachment.get('filename',kind)}
  events.append(e)
 for entry in payload.get('entry',[]):
  for change in entry.get('changes',[]):
   for s in change.get('value',{}).get('statuses',[]):
    if s.get('status') in ('sent','delivered','read','failed'):
     events.append(dict(id='status:'+s['id']+':'+s['status'],type='status',message_id=s['id'],status=s['status']))
 return events
