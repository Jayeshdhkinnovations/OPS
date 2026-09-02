import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

export default async function getTrash(request) {
  const serverUrl = cloudServerUrl;
  const appId = serverAppId;
  const limit = request.params.limit || 100;
  const skip = request.params.skip || 0;
  try {
    const userRes = await axios.get(serverUrl + '/users/me', {
      headers: {
        'X-Parse-Application-Id': appId,
        'X-Parse-Session-Token': request.headers['sessiontoken'],
      },
    });
    const userId = userRes.data && userRes.data.objectId;
    if (!userId) {
      return { error: 'Please provide required parameter!' };
    }
    try {
      const query = new Parse.Query('contracts_Document');
      query.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
      query.equalTo('IsArchive', true);
      query.descending('ArchivedAt');
      query.skip(skip);
      query.limit(limit);
      const res = await query.find({ useMasterKey: true });
      return res;
    } catch (err) {
      console.log('err', err);
      return { error: "You don't have access to trash" };
    }
  } catch (err) {
    console.log('err', err?.response?.data || err);
    if (err.code == 209) {
      return { error: 'Invalid session token' };
    } else {
      return { error: "You don't have access!" };
    }
  }
}
