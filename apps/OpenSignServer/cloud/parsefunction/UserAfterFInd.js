import { useLocal } from '../../Utils.js';
import getPresignedUrl, { presignedlocalUrl } from './getSignedUrl.js';

const resolveUrl = async rawUrl => {
  const isLocal = useLocal == 'true';
  const shouldUsePresigned = useLocal !== 'true';
  if (!rawUrl) return rawUrl;
  if (shouldUsePresigned) {
    return await getPresignedUrl(rawUrl);
  } else if (isLocal) {
    return presignedlocalUrl(rawUrl);
  }
};

async function UserAfterFind(request) {
  // Must always hand back the objects array. Returning undefined - which
  // it did for any result set that wasn't exactly one object - makes Parse
  // reject the surrounding query with a literal `undefined`, surfacing as
  // an unexplainable "Something went wrong" in whatever cloud function
  // happened to include this pointer.
  if (request.objects.length === 1) {
    {
      const obj = request.objects[0];
      const ProfilePic = obj?.get('ProfilePic') && obj?.get('ProfilePic');
      if (ProfilePic) obj.set('ProfilePic', await resolveUrl(ProfilePic));
      return [obj];
    }
  }
  return request.objects;
}
export default UserAfterFind;
