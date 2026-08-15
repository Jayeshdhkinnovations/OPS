async function getUserId(request) {
  try {
    const username = request.params.username;
    const email = request.params.email;
    const query = new Parse.Query(Parse.User);
    if (username) {
      query.equalTo('username', username);
    } else {
      query.equalTo('email', email);
    }
    const user = await query.first({ useMasterKey: true });
    if (!user) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found');
    }
    return { id: user.id };
  } catch (err) {
    console.log('err', err);
    if (err instanceof Parse.Error) {
      throw err;
    }
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Something went wrong');
  }
}
export default getUserId;
