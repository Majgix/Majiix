const sendMessageToMain = (prefix: string, type: string, data: any) => {
    if(type === "debug" || type === "info" || type === "warning"){
        data = prefix + " " + data;
    }
    self.postMessage({
        type: type,
        data: data
    });
}
