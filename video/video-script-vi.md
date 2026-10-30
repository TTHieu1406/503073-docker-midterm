# Kịch bản video thuyết trình (bản tiếng Việt)

Đề tài: Containers in Web Development and Deployment (Docker). Môn 503073 - Lập trình web và ứng dụng.

Đây là bản tiếng Việt. Bản tiếng Anh có cùng nội dung và cùng thứ tự nằm ở file `video-script-en.md`. Không cần đọc thuộc từng chữ: hãy nói lại bằng lời của mình, giữ đúng ý và đúng số liệu.

Tổng thời lượng dự kiến: khoảng 18 phút (đề cho tối đa 20 phút), chia đều hai người. Đề yêu cầu mọi thành viên đều xuất hiện trong video.

| Phút | Nội dung | Người nói |
|---|---|---|
| 0:00 | Mở đầu, lý do chọn đề tài | Hiếu |
| 1:30 | Container hoạt động thế nào | Hiếu |
| 4:30 | Image, layer, multi-stage | Hiếu |
| 6:00 | So sánh container, máy ảo, Compose, Kubernetes | Huy |
| 8:00 | Kiến trúc DockMart | Huy |
| 9:30 | Demo 1: chạy hệ thống, mua hàng | Huy |
| 11:30 | Demo 2: scale, cân bằng tải, tắt container | Hiếu |
| 13:30 | Demo 3: dữ liệu bền vững, bảo mật | Huy |
| 14:30 | Demo 4: Kubernetes | Hiếu |
| 16:30 | Kết quả đo | Huy |
| 17:30 | Kết luận | Hai người |

## Chuẩn bị trước khi quay

1. Mở Docker Desktop. Bật Kubernetes nếu quay phần Demo 4 (Settings → Kubernetes, chọn kind, 3 node).
2. Trong thư mục `source`, chạy trước để lúc quay không phải chờ tải: `docker compose --profile monitoring pull`, rồi `docker compose build`.
3. Xóa dữ liệu cũ để đơn hàng bắt đầu từ số 1: `docker compose --profile monitoring down -v`.
4. Mở sẵn terminal (cỡ chữ lớn), trình duyệt và slide. Tắt thông báo Zalo, Discord.
5. Tài khoản admin: `admin@dockmart.local` / `DockMart-Admin-2026`.
6. Quay thử 1 phút để kiểm tra tiếng. Đề trừ điểm nếu âm thanh hoặc hình ảnh kém.

---

## 0:00 Mở đầu (Hiếu)

**Màn hình:** slide bìa, bật camera cả hai người.

> Chúng em chào thầy và các bạn, chúng em là Trần Trung Hiếu và Nguyễn Đức Nhật Huy. Đây là bài tiểu luận giữa kỳ môn Lập trình web và ứng dụng, do thầy Nguyễn Thái Duy hướng dẫn. Đề tài của nhóm là container trong phát triển và triển khai ứng dụng web, với công cụ Docker.
>
> Lập trình viên nào cũng từng nghe câu "máy em chạy được mà". Code thì không sai, nhưng môi trường xung quanh code lại khác nhau. Container giải quyết chuyện này bằng cách đóng gói ứng dụng cùng mọi thứ nó cần để chạy. Hiện nay đây đã là công nghệ phổ biến: trong khảo sát Stack Overflow năm 2025, 71 phần trăm người tham gia cho biết có dùng Docker.
>
> Trong video này, nhóm sẽ giải thích container thực sự hoạt động thế nào, so sánh nó với các giải pháp khác, rồi giới thiệu DockMart, hệ thống nhóm xây dựng để kiểm chứng lý thuyết. Nhóm không chỉ xây xong rồi thôi, mà còn cố tình làm nó hỏng và đo xem chuyện gì xảy ra.

## 1:30 Container hoạt động thế nào (Hiếu)

**Màn hình:** slide timeline, sau đó slide namespace và cgroup.

> Container ra đời trước Docker khá lâu. Unix đã có chroot từ năm 1979, FreeBSD có Jails từ năm 2000. Điều Docker mang lại vào năm 2013 không phải là một cơ chế cô lập mới, mà là một cách đơn giản để đóng gói và chia sẻ ứng dụng.
>
> Điều quan trọng nhất cần hiểu là container không phải một máy ảo thu nhỏ. Nó là một tiến trình Linux bình thường, được nhân Linux đối xử đặc biệt theo hai cách.
>
> Thứ nhất, namespace kiểm soát những gì tiến trình nhìn thấy. Trong PID namespace riêng, tiến trình tưởng mình là tiến trình số một. Trong network namespace riêng, nó có địa chỉ IP riêng, nên hai container đều có thể dùng cổng 8080.
>
> Thứ hai, control group giới hạn những gì tiến trình được dùng. Container API của nhóm chỉ được dùng tối đa nửa nhân CPU và 256 MB bộ nhớ. Nếu một replica bị rò bộ nhớ, nhân Linux chỉ dừng replica đó chứ không kéo sập cả máy chủ.
>
> Vì không có hệ điều hành khách, container khởi động nhanh và tốn ít bộ nhớ. Nhưng điều đó cũng có nghĩa là mọi container dùng chung một nhân, nên mức cô lập yếu hơn máy ảo. Nhóm sẽ quay lại điểm này ở phần bảo mật.

## 4:30 Image, layer, multi-stage (Hiếu)

**Màn hình:** slide layer, sau đó mở `backend/Dockerfile` trong VS Code.

> Image là một chồng các lớp chỉ đọc. Khi container khởi động, Docker thêm một lớp ghi mỏng ở trên cùng. Vì vậy, ba replica API của nhóm dùng chung một bản image trên đĩa.
>
> Lớp cũng là lý do build cache hoạt động. Trong Dockerfile, nhóm chép các file package và cài thư viện trước, rồi mới chép mã nguồn. Khi sửa một dòng code, các lớp thư viện được lấy lại từ cache.
>
> Nhóm dùng multi-stage build. Một file có bốn target: development, test, build và production. Stage test chạy lint và unit test ngay khi build, nên image không qua được kiểm thử thì không thể tạo ra. Stage cuối chỉ chứa những gì cần để chạy, và chạy bằng user thường, không phải root.
>
> Nhóm đã so sánh với kiểu Dockerfile mà nhiều bài hướng dẫn hay dùng. Bản đơn giản đó nặng 1.718 MB với 57 lỗ hổng mức Critical. Bản của nhóm chỉ 288 MB với 0 lỗ hổng Critical.

## 6:00 So sánh (Huy)

**Màn hình:** slide máy ảo và container, sau đó bảng so sánh công cụ điều phối.

> Tiếp theo em so sánh container với các giải pháp khác. Máy ảo ảo hóa phần cứng, nên mỗi máy ảo khởi động một nhân hệ điều hành riêng. Container dùng chung nhân của máy chủ. Vì vậy container nhẹ và nhanh hơn, còn máy ảo cô lập mạnh hơn. Trong thực tế hai công nghệ này đi cùng nhau: các nhà cung cấp đám mây thường chạy container bên trong máy ảo.
>
> So sánh thứ hai là về điều phối. Docker Compose chạy cả ứng dụng trên một máy. Công cụ này đơn giản và đủ dùng cho nhiều website nhỏ, nhưng máy đó hỏng thì mọi thứ dừng theo. Kubernetes chạy trên nhiều máy. Ta chỉ cần khai báo trạng thái mong muốn, ví dụ ba replica phiên bản 1.1, và các controller sẽ liên tục đưa thực tế về đúng trạng thái đó. Đổi lại, Kubernetes khó học và tốn công vận hành hơn nhiều.
>
> Cho nên Kubernetes không tự động là lựa chọn đúng. Một cửa hàng nhỏ chạy Compose là ổn. Nhóm làm cả hai để đo được sự khác biệt.

## 8:00 Kiến trúc DockMart (Huy)

**Màn hình:** slide kiến trúc.

> Đây là DockMart, một cửa hàng trực tuyến gồm bảy loại container. Trình duyệt chỉ đi vào qua gateway là Nginx. Gateway chuyển trang web tới container web, và chuyển các lệnh gọi API tới một trong ba replica. Đơn hàng được đưa vào hàng đợi trong Redis, rồi các container worker xử lý ở phía sau. Dữ liệu nằm trong PostgreSQL, trên một named volume.
>
> Có hai quyết định thiết kế quan trọng nhất. Một là API không giữ trạng thái: phiên đăng nhập là token đã ký, còn cache và hàng đợi nằm trong Redis, nên replica nào cũng phục vụ được mọi request. Nhờ vậy mới scale an toàn. Hai là cơ sở dữ liệu nằm trong mạng nội bộ: gateway hoàn toàn không có đường đi tới chúng.
>
> Bây giờ em sẽ chạy thử cho thầy và các bạn xem.

## 9:30 Demo 1: chạy hệ thống, mua hàng (Huy)

**Màn hình:** terminal và trình duyệt.

Thao tác:

1. Chạy `docker compose up -d --build --wait`.
2. Chạy `docker compose ps`.
3. Mở `http://localhost:8080`, tạo tài khoản, thêm 2 sản phẩm, đặt hàng.
4. Ở trang **My orders**, để mọi người thấy trạng thái tự chạy.

> Chỉ một lệnh là cả hệ thống khởi động, và máy này chỉ cần cài Docker. Compose khởi động các service theo đúng thứ tự dựa trên health check: PostgreSQL và Redis khỏe trước, sau đó một container chạy một lần để tạo bảng dữ liệu, rồi tới API, và gateway là cuối cùng.
>
> Đây là cửa hàng. Em tạo tài khoản, thêm vài sản phẩm và đặt hàng. Mọi người để ý trạng thái đơn hàng: em không hề tải lại trang. Một container worker đang xử lý đơn, và từng bước được gửi tới trình duyệt qua Redis và kết nối Server-Sent Events. Dòng cuối cho biết worker nào đã xử lý.

## 11:30 Demo 2: scale, cân bằng tải, tắt container (Hiếu)

**Màn hình:** đăng nhập admin, trang **Ops Center**, chia đôi màn hình với terminal.

Thao tác:

1. Bấm **Send 300 requests**.
2. Chạy `docker compose up -d --scale api=5 --no-recreate`, chờ 2 thẻ mới xuất hiện, bấm lại **Send 300 requests**.
3. Bấm **Kill** trên một thẻ API.
4. Chỉ vào thẻ đó: `Uptime` về 0 và `Restarts` tăng 1.

> Đây là Ops Center. Mỗi thẻ là một replica đang chạy, tự báo cáo về Redis mỗi hai giây. Em gửi 300 request qua gateway, và các thanh cho thấy chúng được chia đều cho ba replica.
>
> Giờ em tăng lên năm replica chỉ bằng một lệnh, trong lúc website vẫn chạy. Hai thẻ mới xuất hiện. Em gửi lại, và lần này năm replica cùng chia tải. Em không đụng gì tới gateway: Nginx tự đọc lại DNS nên tự tìm thấy replica mới.
>
> Bây giờ em sẽ phá hệ thống. Em bấm Kill, tiến trình đó sập thật, và restart policy của Docker đưa nó quay lại chỉ sau vài giây. Mọi người nhìn vào thẻ này: Uptime về không, bộ đếm Restarts tăng thêm một, và nhật ký sự kiện ghi lại lần sập. Trong thí nghiệm, 0 trên 4.001 request bị lỗi khi xảy ra sự cố, vì gateway tự thử lại ở replica khác.
>
> Nhóm còn rút ra một điều: nếu tự chạy lệnh docker kill, Docker coi đó là quyết định của người vận hành nên restart policy sẽ không đưa container quay lại. Restart policy dành cho sự cố, không dành cho thao tác có chủ đích.

## 13:30 Demo 3: dữ liệu bền vững, bảo mật (Huy)

**Màn hình:** terminal.

Thao tác:

1. `docker compose rm -sf postgres`, rồi `docker compose up -d postgres`.
2. Tải lại trang **My orders**: đơn hàng vẫn còn.
3. `docker compose exec gateway nc -z -w2 postgres 5432`: báo `bad address`.
4. `docker compose exec api sh -c 'id; touch /app/x; grep CapEff /proc/1/status'`.

> Em vừa xóa hẳn container cơ sở dữ liệu. Em tạo lại container mới, tải lại trang, và đơn hàng vẫn còn, vì dữ liệu nằm trong volume chứ không nằm trong container.
>
> Về bảo mật, từ gateway em thử kết nối PostgreSQL thì cái tên đó còn không phân giải được, vì hai mạng tách biệt nhau. Bên trong container API, user không phải root, hệ thống file chỉ đọc, và tập capability bằng không hết. Nên kể cả khi kẻ tấn công lọt được vào, họ cũng làm được rất ít.

## 14:30 Demo 4: Kubernetes (Hiếu)

**Màn hình:** terminal, chạy trước `kubectl -n dockmart get pods -o wide`.

Thao tác (đã triển khai sẵn theo README mục 6):

1. `kubectl -n dockmart get pods -o wide`.
2. `kubectl -n dockmart set image deploy/api api=dockmart/backend:1.1.0`, rồi `kubectl -n dockmart get pods -w`.
3. `kubectl -n dockmart rollout undo deploy/api`.
4. Nếu đủ thời gian: `kubectl -n dockmart get hpa`.

> Những image đó giờ chạy trên một cluster Kubernetes ba node mà không sửa một dòng code nào, chỉ thay đổi phần mô tả cách chạy. Ở đây có thể thấy các pod được rải trên nhiều node.
>
> Giờ em cập nhật lên phiên bản 1.1. Kubernetes khởi động một pod mới, chờ nó sẵn sàng rồi mới gỡ một pod cũ. Nhóm đã chạy việc này với 100 request mỗi giây: trong 7.500 request, có 0 request lỗi, và quá trình cập nhật mất 14,2 giây. Nếu phiên bản mới có lỗi, chỉ một lệnh là quay lại bản cũ.
>
> Nhóm cũng thử tự động scale. Khi tải nặng, Kubernetes tăng từ ba lên tám replica trong khoảng 60 giây, và trở về ba sau khi hết tải. Trên Compose, việc này phải do người làm bằng tay.

## 16:30 Kết quả đo (Huy)

**Màn hình:** slide biểu đồ.

> Những gì nhóm nói đều đã được đo. Thông lượng tăng từ 107 request mỗi giây với một replica lên 510 với sáu replica, gấp 4,8 lần. Image nhỏ đi 6 lần, và chín container đang chạy khi rảnh chỉ dùng khoảng 227 MB bộ nhớ.
>
> Việc đo cũng chỉ ra lỗi của chính nhóm. Phiên bản đầu bị treo khi Redis dừng, trên Kubernetes một lần lỗi liveness làm mất hai request, và một mặc định mới của Nginx khiến tải chỉ đi vào vài Pod. Nhóm chỉ phát hiện được nhờ cố tình gây lỗi, và đã sửa hết. Bây giờ, khi Redis dừng, danh mục sản phẩm vẫn chạy từ PostgreSQL, chỉ riêng đặt hàng bị từ chối kèm thông báo rõ ràng.

## 17:30 Kết luận (Hiếu, rồi Huy)

**Màn hình:** slide kết luận, bật camera cả hai người.

**Hiếu:**

> Tóm lại, container thực sự mang lại tính di động, tính nhất quán và hiệu quả tài nguyên, nhưng nó không thay ta thiết kế ứng dụng. Scale được là nhờ API không giữ trạng thái. Cập nhật không gián đoạn được là nhờ xử lý đúng tín hiệu tắt.

**Huy:**

> Và công cụ phù hợp tùy vào bài toán. Compose là đủ khi chạy trên một máy, còn Kubernetes chỉ xứng đáng với độ phức tạp của nó khi cần cập nhật không gián đoạn và tự động scale. Trong tương lai nhóm muốn bổ sung HTTPS, cơ sở dữ liệu có bản sao và triển khai thật trên đám mây. Chúng em xin cảm ơn thầy và các bạn đã theo dõi.

---

## Sau khi quay

Kiểm tra lại: có đủ hai người, tiếng rõ, dưới 20 phút, đọc được chữ trong terminal. Xuất file MP4 và nộp cùng báo cáo, mã nguồn, README theo hướng dẫn của giảng viên.
