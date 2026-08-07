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

async function TenantAterFind(request) {
  // Must always hand back the objects array. Returning undefined - which
  // it did for any result set that wasn't exactly one object - makes Parse
  // reject the surrounding query with a literal `undefined`, surfacing as
  // an unexplainable "Something went wrong" in whatever cloud function
  // happened to include this pointer.
  if (request.objects.length === 1) {
    {
      const obj = request.objects[0];
      const Logo = obj?.get('Logo') && obj?.get('Logo');
      const Favicon = obj?.get('Favicon') && obj?.get('Favicon');

      if (Logo) obj.set('Logo', await resolveUrl(Logo));
      if (Favicon) obj.set('Favicon', await resolveUrl(Favicon));
      return [obj];
    }
  }
  return request.objects;
}
export default TenantAterFind;
