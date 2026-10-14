import React, { useState } from 'react';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, TextInput, TouchableOpacity } from 'react-native';
import { faceApi } from '../../utils/faceApi';
export default function ForgotPassword() {
  const [email,setEmail]=useState(''),[requestId,setRequestId]=useState('');
  const [code,setCode]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  async function submit(){
    if(busy)return;setBusy(true);setError('');
    try{
      if(!requestId){
        const result=await faceApi('/recovery/request',{email:email.trim().toLowerCase()});
        if(!/^[a-f0-9]{32}$/.test(result.recoveryId||''))throw Error('Invalid recovery response.');
        setRequestId(result.recoveryId);setMessage(result.message);
      }else{
        if(password!==confirm)throw Error('Passwords do not match.');
        const result=await faceApi('/recovery/confirm',{recoveryId:requestId,code,password});
        if(result.reset!==true)throw Error('Password reset was not confirmed.');
        setPassword('');setConfirm('');setCode('');setRequestId('');setDone(true);setMessage('Password updated. Return to Login and use your new password.');
      }
    }catch(failure){setError(failure.message||'Recovery request failed.');}finally{setBusy(false);}
  }
  const inputStyle={borderWidth:1,borderColor:'#aaa',borderRadius:8,padding:14,marginVertical:8};
  return <SafeAreaView style={{flex:1,backgroundColor:'#f3f6f2'}}><ScrollView contentContainerStyle={{padding:24,gap:12}} keyboardShouldPersistTaps="handled">
    <Text style={{fontSize:26,color:'#244b47'}}>Forgot Password</Text>
    {!done&&(!requestId?<TextInput style={inputStyle} accessibilityLabel="Account email" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"/>:<>
      <Text>Enter the six-digit email code within five minutes. Use a new password with 15 to 128 characters.</Text>
      <TextInput style={inputStyle} accessibilityLabel="Recovery code" placeholder="Recovery code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}/>
      <TextInput style={inputStyle} accessibilityLabel="New password" placeholder="New password" secureTextEntry value={password} onChangeText={setPassword}/>
      <TextInput style={inputStyle} accessibilityLabel="Confirm new password" placeholder="Confirm password" secureTextEntry value={confirm} onChangeText={setConfirm}/>
    </>)}
    {!!message&&<Text accessibilityLiveRegion="polite">{message}</Text>}
    {!!error&&<Text accessibilityRole="alert" style={{color:'#b42318'}}>{error}</Text>}
    {!done&&<TouchableOpacity disabled={busy} onPress={submit}><Text style={{padding:16,backgroundColor:'#28745a',color:'white'}}>{busy?'Please wait…':requestId?'Reset password':'Request recovery code'}</Text></TouchableOpacity>}
    {!!requestId&&<TouchableOpacity disabled={busy} onPress={()=>{setRequestId('');setCode('');setPassword('');setConfirm('');setMessage('');setError('');}}><Text>Request a new code</Text></TouchableOpacity>}
    <TouchableOpacity onPress={()=>router.back()}><Text>Return to Login</Text></TouchableOpacity>
  </ScrollView></SafeAreaView>;
}
