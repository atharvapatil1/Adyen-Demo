function truncate(value, length = 48) {
  return typeof value === "string" && value.length > length ? `${value.slice(0, length)}… (${value.length} chars)` : value;
}

// Turn an Adyen library error into something safe and readable for the UI.
function describeAdyenError(err) {
  let body;
  try {
    body = err.responseBody ? JSON.parse(err.responseBody) : undefined;
  } catch {
    body = err.responseBody;
  }
  return {
    status: err.statusCode,
    message: body?.message || err.message,
    errorCode: body?.errorCode || err.errorCode,
    errorType: body?.errorType,
  };
}

module.exports = { truncate, describeAdyenError };
