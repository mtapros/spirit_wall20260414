export const getVal = id => parseInt(document.getElementById(id).value, 10);
export const getStr = id => document.getElementById(id).value;
export const getMode = () => document.querySelector('input[name="mode"]:checked').value;
export const setStatus = msg => { document.getElementById("status").textContent = msg; };
