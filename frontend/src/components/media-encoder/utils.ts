enum State {
    Created = "created",
    Instatiated = "instatiated",
    Running = "running",
    Stopped = "stopped",
}

function sendMessageToMain(prefix: string, type: any, data: any){
    if(type === "debug" || type === "info" || type === "warning"){
        data = prefix + " " + data;
    }
    self.postMessage({
        type: type,
        data: data
    });
}

function isMetadataValid(metadata: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata | undefined) {
    return metadata != undefined && 'decoderConfig' in metadata;
}

function arrayBufferToBase64(buffer: any) {
    let binary = '';  
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++){
        binary += String.fromCharCode(bytes[i] as number);
    }
    
    return btoa(binary);
}

function serializeMetadata(metadata: EncodedAudioChunkMetadata | EncodedVideoChunkMetadata | undefined ) {
    let ret = undefined;
    if (isMetadataValid(metadata)) {
        let newData: any = {};

        //Copy all enumerable own properties
        newData['decoderConfig'] = Object.assign({}, metadata?.decoderConfig);

        if (metadata?.decoderConfig?.description){
            newData['decoderConfig']['descriptionInBase64'] = arrayBufferToBase64(metadata?.decoderConfig.description);
            delete newData.description;
        }
        //Encode
        const encoder = new TextEncoder();
        ret = encoder.encode(JSON.stringify(newData));
    }
    return ret;
}
