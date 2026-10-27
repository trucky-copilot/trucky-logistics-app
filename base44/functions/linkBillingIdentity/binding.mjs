export async function reserveNativeBinding(command, googleSub, nativeId) {
 if(typeof googleSub!=='string'||!googleSub||typeof nativeId!=='string'||!nativeId)throw Error('INVALID_IDENTITY');
 const key=`trucky:billing:identity:v1:${googleSub}`;
 const inserted=await command(['SET',key,nativeId,'NX']);
 if(inserted==='OK')return;
 const existing=await command(['GET',key]);
 if(existing!==nativeId)throw Error('IDENTITY_ALREADY_BOUND');
}
